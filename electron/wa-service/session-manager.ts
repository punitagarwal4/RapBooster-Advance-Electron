/**
 * Device session lifecycle: connect, reconnect, give up (SPRINTS.md §6.5).
 *
 * The reconnect policy is anti-ban critical (CLAUDE.md §5.4). A tight retry loop
 * against WhatsApp looks like an attack and is a reliable way to get a customer's
 * account banned — which is unrecoverable. So: exponential backoff with jitter,
 * a hard ceiling, and a circuit breaker that stops and asks the user rather than
 * hammering forever.
 */
import type { Transport } from './transport/types'
import type { DeviceStatus } from '../../shared/types'

const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 60_000
const MAX_ATTEMPTS = 10
/** ±20%, so twenty devices dropped by one network blip do not retry in lockstep. */
const JITTER = 0.2

export interface SessionCallbacks {
  onStatus: (deviceId: string, status: DeviceStatus, detail?: { phone?: string; error?: string }) => void
  onGiveUp: (deviceId: string, attempts: number, detail: string) => void
  onLog: (level: 'info' | 'warn' | 'error', message: string) => void
}

interface SessionState {
  authDir: string
  attempts: number
  timer?: NodeJS.Timeout
  /** Set when the user asked to stop, so an in-flight close does not retry. */
  intentionallyClosed: boolean
}

export function backoffDelay(attempt: number): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)
  const jitter = exponential * JITTER * (Math.random() * 2 - 1)
  return Math.max(BASE_DELAY_MS, Math.round(exponential + jitter))
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionState>()

  constructor(
    private readonly transport: Transport,
    private readonly callbacks: SessionCallbacks,
  ) {
    this.transport.on('disconnected', (deviceId, kind, detail) => {
      this.handleDisconnect(deviceId, kind, detail)
    })
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  async connect(deviceId: string, authDir: string): Promise<void> {
    const existing = this.sessions.get(deviceId)
    if (existing?.timer) clearTimeout(existing.timer)

    this.sessions.set(deviceId, {
      authDir,
      // A manual connect is the user asking again, so the budget resets.
      attempts: existing?.attempts ?? 0,
      intentionallyClosed: false,
    })

    await this.transport.connect(deviceId, authDir)
  }

  /** A successful connection clears the retry budget. */
  noteConnected(deviceId: string): void {
    const session = this.sessions.get(deviceId)
    if (session) session.attempts = 0
  }

  async disconnect(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId)
    if (session) {
      session.intentionallyClosed = true
      if (session.timer) clearTimeout(session.timer)
    }
    await this.transport.disconnect(deviceId)
  }

  async logout(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId)
    if (session?.timer) clearTimeout(session.timer)
    this.sessions.delete(deviceId)
    await this.transport.logout(deviceId)
  }

  private handleDisconnect(deviceId: string, kind: 'retryable' | 'logged_out', detail: string): void {
    const session = this.sessions.get(deviceId)
    if (!session) return

    // Terminal: credentials are dead, retrying can only make things worse.
    if (kind === 'logged_out') {
      if (session.timer) clearTimeout(session.timer)
      this.sessions.delete(deviceId)
      this.callbacks.onLog('warn', `device ${deviceId} logged out: ${detail}`)
      return
    }

    if (session.intentionallyClosed) return

    if (session.attempts >= MAX_ATTEMPTS) {
      // Circuit breaker open. Stop and tell the user rather than looping
      // forever — a device that cannot connect after ten tries has a real
      // problem that retrying will not fix.
      this.callbacks.onLog(
        'error',
        `device ${deviceId} gave up after ${session.attempts} attempts: ${detail}`,
      )
      this.callbacks.onGiveUp(deviceId, session.attempts, detail)
      this.callbacks.onStatus(deviceId, 'disconnected', {
        error: `Could not reconnect after ${session.attempts} attempts.`,
      })
      return
    }

    const delay = backoffDelay(session.attempts)
    session.attempts += 1
    this.callbacks.onLog(
      'warn',
      `device ${deviceId} disconnected (${detail}); retry ${session.attempts} in ${delay}ms`,
    )
    this.callbacks.onStatus(deviceId, 'connecting')

    session.timer = setTimeout(() => {
      void this.transport.connect(deviceId, session.authDir).catch((err) => {
        // A failed reconnect attempt is itself a retryable disconnect.
        this.callbacks.onLog('error', `device ${deviceId} reconnect threw: ${String(err)}`)
        this.handleDisconnect(deviceId, 'retryable', String(err))
      })
    }, delay)
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.timer) clearTimeout(session.timer)
    }
    this.sessions.clear()
    await this.transport.shutdown()
  }
}

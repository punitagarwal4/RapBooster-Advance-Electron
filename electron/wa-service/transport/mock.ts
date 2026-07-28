/**
 * Deterministic in-memory transport.
 *
 * WHY it exists: every automated test that touches sending must use this.
 * Pointing CI at a real WhatsApp account risks a permanent ban, which is
 * unrecoverable (CLAUDE.md §5.4). It also makes campaign, group and inbox
 * behaviour reproducible — real WhatsApp is neither fast nor deterministic.
 *
 * Behaviour is tuned by environment variables so a spec can script failure
 * without a bespoke build:
 *   WA_MOCK_FAIL_RATE   0..1, fraction of sends that fail (default 0)
 *   WA_MOCK_LATENCY_MS  artificial per-send delay (default 0)
 *   WA_MOCK_CONNECT_MS  delay before a device reports connected (default 50)
 *   WA_MOCK_INCOMING    inbound messages synthesised per linked device (default 0)
 *   WA_MOCK_SEND_LOG    file to append every send to as JSONL, for assertions
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { TransportEmitter } from './emitter'
import type { OutgoingMessage, RemoteGroup, SendResult, Transport } from './types'

const num = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Append every send to a JSONL file when WA_MOCK_SEND_LOG points at one.
 *
 * WHY a file rather than a new IPC channel: nothing in the app could previously
 * assert *what* was sent — the mock counted sends and dropped the payload — so
 * the button and list shapes had no way to be tested. A file keeps the test seam
 * inside code that already only exists for tests; production never loads this
 * transport, so there is no new surface to secure.
 */
function recordSend(deviceId: string, to: string, message: OutgoingMessage): void {
  const path = process.env.WA_MOCK_SEND_LOG
  if (!path) return
  try {
    appendFileSync(path, `${JSON.stringify({ deviceId, to, message })}\n`, 'utf8')
  } catch (err) {
    // A broken test seam must never fail a send the app is making.
    console.debug('mock: could not write the send log', err)
  }
}

interface MockSession {
  deviceId: string
  connected: boolean
  phone: string
  sent: number
}

export class MockTransport extends TransportEmitter implements Transport {
  private readonly sessions = new Map<string, MockSession>()
  private counter = 0

  /** Deterministic pseudo-phone so assertions can rely on it. */
  private phoneFor(deviceId: string): string {
    let hash = 0
    for (const ch of deviceId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
    return `+9199${String(Math.abs(hash) % 100_000_000).padStart(8, '0')}`
  }

  private nextId(prefix: string): string {
    this.counter += 1
    return `${prefix}_${Date.now().toString(36)}_${this.counter}`
  }

  async connect(deviceId: string, authDir: string): Promise<void> {
    // The real transport writes credentials here; creating it keeps the
    // on-disk layout identical between mock and production runs.
    mkdirSync(authDir, { recursive: true })

    const session: MockSession = {
      deviceId,
      connected: false,
      phone: this.phoneFor(deviceId),
      sent: 0,
    }
    this.sessions.set(deviceId, session)

    this.emit('status', deviceId, 'connecting')
    this.emit('qr', deviceId, `mock-qr:${deviceId}:${Date.now()}`)
    this.emit('status', deviceId, 'qr_pending')

    setTimeout(
      () => {
        const current = this.sessions.get(deviceId)
        if (!current) return
        current.connected = true
        this.emit('status', deviceId, 'connected', { phone: current.phone })

        // Inbox specs need inbound traffic. Driving it from here rather than
        // exposing a "simulate" IPC channel keeps the test hook inside code that
        // is already test-only — production never ships this transport.
        const inbound = num('WA_MOCK_INCOMING', 0)
        for (let i = 0; i < inbound; i += 1) {
          setTimeout(
            () =>
              this.simulateIncoming(
                deviceId,
                `Mock inbound ${i + 1}`,
                `+91999900${i}011`,
              ),
            100 * (i + 1),
          )
        }
      },
      num('WA_MOCK_CONNECT_MS', 50),
    )
  }

  async requestPairingCode(deviceId: string, _phone: string): Promise<string> {
    const code = '12345678'
    this.emit('status', deviceId, 'pairing_pending')
    this.emit('pairingCode', deviceId, code)

    setTimeout(
      () => {
        const current = this.sessions.get(deviceId)
        if (!current) return
        current.connected = true
        this.emit('status', deviceId, 'connected', { phone: current.phone })
      },
      num('WA_MOCK_CONNECT_MS', 50),
    )

    return code
  }

  async disconnect(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId)
    if (!session) return
    session.connected = false
    this.emit('status', deviceId, 'disconnected')
    this.emit('disconnected', deviceId, 'retryable', 'mock: disconnect requested')
  }

  async logout(deviceId: string): Promise<void> {
    this.sessions.delete(deviceId)
    this.emit('status', deviceId, 'logged_out')
    this.emit('disconnected', deviceId, 'logged_out', 'mock: logged out')
  }

  isConnected(deviceId: string): boolean {
    return this.sessions.get(deviceId)?.connected ?? false
  }

  async send(
    deviceId: string,
    to: string,
    message: OutgoingMessage,
  ): Promise<SendResult> {
    const session = this.sessions.get(deviceId)
    if (!session?.connected) {
      throw new Error(`mock: device ${deviceId} is not connected`)
    }

    recordSend(deviceId, to, message)

    const latency = num('WA_MOCK_LATENCY_MS', 0)
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency))

    const failRate = num('WA_MOCK_FAIL_RATE', 0)
    if (failRate > 0) {
      // Deterministic per-send rather than random: the Nth send of a run fails
      // the same way every time, so a failing test reproduces exactly.
      session.sent += 1
      const period = Math.max(1, Math.round(1 / failRate))
      if (session.sent % period === 0) {
        throw new Error(`mock: simulated send failure to ${to}`)
      }
    } else {
      session.sent += 1
    }

    return { messageId: this.nextId('mock') }
  }

  async fetchGroups(deviceId: string): Promise<RemoteGroup[]> {
    if (!this.isConnected(deviceId)) {
      throw new Error(`mock: device ${deviceId} is not connected`)
    }
    return [
      {
        id: `${deviceId}-group-1@g.us`,
        name: 'Sales Team 001',
        memberCount: 15,
        isAdmin: true,
      },
      {
        id: `${deviceId}-group-2@g.us`,
        name: 'Support Group A',
        memberCount: 8,
        isAdmin: true,
      },
      {
        id: `${deviceId}-group-3@g.us`,
        name: 'Marketing Team 001',
        memberCount: 12,
        isAdmin: false,
      },
    ]
  }

  async createGroup(
    deviceId: string,
    subject: string,
    participants: string[],
  ): Promise<RemoteGroup> {
    if (!this.isConnected(deviceId)) {
      throw new Error(`mock: device ${deviceId} is not connected`)
    }
    return {
      id: this.nextId('mockgroup') + '@g.us',
      name: subject,
      memberCount: participants.length,
      isAdmin: true,
    }
  }

  async shutdown(): Promise<void> {
    this.sessions.clear()
  }

  // ── test affordances, not part of the Transport contract ──

  /** Push a synthetic inbound message, for inbox and auto-reply specs. */
  simulateIncoming(deviceId: string, body: string, from = '+919999000011'): void {
    this.emit('message', deviceId, {
      id: this.nextId('in'),
      chatId: `${from}@s.whatsapp.net`,
      from,
      pushName: 'Mock Contact',
      isGroup: false,
      type: 'text',
      body,
      fileName: null,
      fileSize: null,
      timestamp: new Date().toISOString(),
    })
  }

  /** Drop a connection the way a network failure would. */
  simulateDrop(deviceId: string): void {
    const session = this.sessions.get(deviceId)
    if (!session) return
    session.connected = false
    this.emit('status', deviceId, 'disconnected')
    this.emit('disconnected', deviceId, 'retryable', 'mock: simulated network drop')
  }
}

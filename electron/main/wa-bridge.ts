/**
 * Supervisor for the `wa-service` utility process (SPRINTS.md §5.1 T2.1).
 *
 * Responsibilities: spawn it, keep it alive, and make its death survivable.
 * On restart, session state is rebuilt **from SQLite, never from memory**
 * (CLAUDE.md §5.5) — the whole point of the separate process is that losing it
 * must not lose work.
 */
import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type {
  WaEventKind,
  WaEvents,
  WaMessage,
  WaRequestKind,
  WaRequests,
  WaResponseEnvelope,
  WaResponses,
} from '../../shared/wa-protocol'
import { isEventEnvelope } from '../../shared/wa-protocol'

const HEALTH_INTERVAL_MS = 15_000
const HEALTH_TIMEOUT_MS = 5_000
const RESTART_BASE_MS = 500
const RESTART_MAX_MS = 30_000
const REQUEST_TIMEOUT_MS = 60_000

type EventHandler<K extends WaEventKind> = (payload: WaEvents[K]) => void

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

export type ServiceState = 'starting' | 'up' | 'restarting' | 'down'

export class WaBridge {
  private child: UtilityProcess | undefined
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly handlers = new Map<WaEventKind, Array<EventHandler<WaEventKind>>>()
  private health: NodeJS.Timeout | undefined
  private restarts = 0
  private state: ServiceState = 'down'
  private stopping = false
  private onStateChange: ((state: ServiceState, restarts: number) => void) | undefined
  /** Rebuilt after a restart; supplied by main from the database. */
  private recover: (() => Promise<void>) | undefined

  setStateListener(listener: (state: ServiceState, restarts: number) => void): void {
    this.onStateChange = listener
  }

  /** Called after every successful (re)start so main can re-open sessions. */
  setRecoveryHook(recover: () => Promise<void>): void {
    this.recover = recover
  }

  private setState(next: ServiceState): void {
    if (this.state === next) return
    this.state = next
    this.onStateChange?.(next, this.restarts)
  }

  private servicePath(): string {
    // electron-vite emits the service as an extra entry of the main build,
    // so it lands in a subdirectory of out/main.
    return join(__dirname, 'wa-service', 'index.js')
  }

  start(): void {
    if (this.child) return
    this.stopping = false
    this.setState(this.restarts === 0 ? 'starting' : 'restarting')

    const child = utilityProcess.fork(this.servicePath(), [], {
      serviceName: 'wa-service',
      stdio: 'inherit',
      env: {
        ...process.env,
        // Inherited so the mock transport survives a restart during tests.
        ...(process.env.WA_TRANSPORT ? { WA_TRANSPORT: process.env.WA_TRANSPORT } : {}),
      },
    })
    this.child = child

    child.on('message', (message: WaMessage) => this.receive(message))

    child.on('exit', (code) => {
      this.child = undefined
      this.stopHealth()

      // Every in-flight request is now unanswerable; failing them immediately
      // beats leaving callers hanging until their timeout.
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('wa-service exited before responding'))
        this.pending.delete(id)
      }

      // A deliberate stop must not trigger the restart ladder.
      if (this.stopping) {
        this.setState('down')
        return
      }

      this.restarts += 1
      const delay = Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** Math.min(this.restarts, 6))
      console.warn(`wa-service exited (code ${code}); restarting in ${delay}ms`)
      this.setState('restarting')
      setTimeout(() => {
        if (this.stopping) return
        this.start()
      }, delay)
    })

    this.startHealth()
  }

  private startHealth(): void {
    this.stopHealth()
    this.health = setInterval(() => {
      void this.request('service:ping', {}, HEALTH_TIMEOUT_MS)
        .then(() => this.setState('up'))
        .catch(() => {
          // A missed ping means the process is wedged rather than crashed.
          // Killing it converts an unrecoverable hang into a normal restart.
          console.error('wa-service health check failed; killing to force restart')
          this.child?.kill()
        })
    }, HEALTH_INTERVAL_MS)
  }

  private stopHealth(): void {
    if (this.health) clearInterval(this.health)
    this.health = undefined
  }

  private receive(message: WaMessage): void {
    if (isEventEnvelope(message)) {
      // The first event proves the child is alive and listening.
      if (this.state !== 'up') {
        this.setState('up')
        void this.recover?.().catch((err) =>
          console.error('wa-service recovery hook failed', err),
        )
      }
      for (const handler of this.handlers.get(message.event) ?? []) {
        try {
          handler(message.payload)
        } catch (err) {
          console.error(`wa-bridge: handler for ${message.event} threw`, err)
        }
      }
      return
    }

    const response = message as WaResponseEnvelope
    const pending = this.pending.get(response.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(response.id)

    if (response.result.ok) pending.resolve(response.result.data)
    else pending.reject(new Error(response.result.error))
  }

  on<K extends WaEventKind>(event: K, handler: EventHandler<K>): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler as EventHandler<WaEventKind>)
    this.handlers.set(event, list)
  }

  async request<K extends WaRequestKind>(
    kind: K,
    payload: WaRequests[K],
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<WaResponses[K]> {
    const child = this.child
    if (!child) throw new Error('wa-service is not running')

    const id = this.nextId++
    return new Promise<WaResponses[K]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`wa-service request "${kind}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      child.postMessage({ id, kind, payload })
    })
  }

  isRunning(): boolean {
    return this.child !== undefined
  }

  currentState(): ServiceState {
    return this.state
  }

  restartCount(): number {
    return this.restarts
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.stopHealth()
    if (!this.child) return
    try {
      await this.request('service:shutdown', {}, 5_000)
    } catch {
      // Already gone or wedged; the kill below is the fallback.
    }
    this.child?.kill()
    this.child = undefined
    this.setState('down')
  }
}

export const waBridge = new WaBridge()

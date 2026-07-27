/**
 * Send pacing — the anti-ban core (SPRINTS.md §6.1, CLAUDE.md §5.4).
 *
 * WHY it lives in wa-service rather than in the caller: this is the last gate
 * before the socket, so nothing can bypass it. A campaign worker, a group
 * runner, an inbox reply and an AI auto-reply all end up here, and a bug in any
 * one of them still cannot flood WhatsApp. Pacing enforced at the call site
 * would only be as good as the least careful caller.
 *
 * Per device it enforces, in order:
 *   1. the daily cap
 *   2. a sleep pause after every N messages
 *   3. a random delay drawn fresh for each send
 *   4. strictly one in-flight message
 *
 * Concurrency comes from running several devices, never from parallel sends on
 * one account — that is the fastest route to a ban.
 */

export interface ThrottleConfig {
  delayFromMs: number
  delayToMs: number
  sleepDurationMs: number
  sleepAfter: number
  /** 0 means unlimited. */
  dailyCap: number
}

export const DEFAULT_THROTTLE: ThrottleConfig = {
  delayFromMs: 0,
  delayToMs: 5_000,
  sleepDurationMs: 10_000,
  sleepAfter: 10,
  dailyCap: 0,
}

export class DailyCapReachedError extends Error {
  constructor(deviceId: string, cap: number) {
    super(`device ${deviceId} reached its daily cap of ${cap}`)
    this.name = 'DailyCapReachedError'
  }
}

interface DeviceState {
  config: ThrottleConfig
  sentSinceSleep: number
  sentToday: number
  dayStamp: string
  /** Serializes sends: each waits for the previous one to finish. */
  chain: Promise<void>
}

const localDay = (now: Date): string =>
  `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))

export class ThrottleScheduler {
  private readonly devices = new Map<string, DeviceState>()
  /** Injectable so tests can assert pacing without waiting in real time. */
  constructor(private readonly wait: (ms: number) => Promise<void> = sleep) {}

  configure(deviceId: string, config: Partial<ThrottleConfig>): void {
    const state = this.state(deviceId)
    state.config = { ...state.config, ...config }
  }

  private state(deviceId: string): DeviceState {
    let state = this.devices.get(deviceId)
    if (!state) {
      state = {
        config: { ...DEFAULT_THROTTLE },
        sentSinceSleep: 0,
        sentToday: 0,
        dayStamp: localDay(new Date()),
        chain: Promise.resolve(),
      }
      this.devices.set(deviceId, state)
    }
    return state
  }

  /** Restore today's count after a restart, so the cap survives one. */
  seed(deviceId: string, sentToday: number): void {
    const state = this.state(deviceId)
    state.sentToday = sentToday
  }

  sentToday(deviceId: string): number {
    const state = this.state(deviceId)
    this.rollDay(state)
    return state.sentToday
  }

  private rollDay(state: DeviceState): void {
    const today = localDay(new Date())
    if (state.dayStamp !== today) {
      state.dayStamp = today
      state.sentToday = 0
    }
  }

  /**
   * Run `task` under this device's pacing rules.
   *
   * Returning the task's value rather than a permit means a caller cannot
   * acquire and then forget to release, which would wedge the device forever.
   */
  async run<T>(deviceId: string, task: () => Promise<T>): Promise<T> {
    const state = this.state(deviceId)

    // Queue behind whatever this device is already doing. This is what
    // guarantees one in-flight message per account.
    const previous = state.chain
    let release!: () => void
    state.chain = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous.catch(() => {
      // A failed predecessor must not block the queue.
    })

    try {
      this.rollDay(state)

      const { dailyCap, sleepAfter, sleepDurationMs, delayFromMs, delayToMs } = state.config

      if (dailyCap > 0 && state.sentToday >= dailyCap) {
        throw new DailyCapReachedError(deviceId, dailyCap)
      }

      if (sleepAfter > 0 && state.sentSinceSleep >= sleepAfter) {
        await this.wait(sleepDurationMs)
        state.sentSinceSleep = 0
      }

      const low = Math.min(delayFromMs, delayToMs)
      const high = Math.max(delayFromMs, delayToMs)
      await this.wait(low + Math.random() * (high - low))

      const result = await task()

      // Counted only on success: a failed send did not reach WhatsApp, so it
      // must not consume the user's daily allowance.
      state.sentSinceSleep += 1
      state.sentToday += 1
      return result
    } finally {
      release()
    }
  }

  reset(deviceId: string): void {
    this.devices.delete(deviceId)
  }
}

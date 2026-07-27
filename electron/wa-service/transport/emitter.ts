import type { TransportEvents } from './types'

/**
 * Minimal typed event emitter shared by the transports.
 *
 * Node's EventEmitter would work, but its types are loose enough that a
 * mistyped payload only surfaces at runtime — which is exactly the class of bug
 * this codebase validates against everywhere else.
 */
export class TransportEmitter {
  /**
   * Stored loosely and cast at the boundary: a mapped type of arrays makes the
   * element type a union, and TypeScript narrows `push` to `never` because no
   * single value satisfies every member. The public methods stay fully typed.
   */
  private readonly handlers = new Map<keyof TransportEvents, unknown[]>()

  on<E extends keyof TransportEvents>(event: E, handler: TransportEvents[E]): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  protected emit<E extends keyof TransportEvents>(
    event: E,
    ...args: Parameters<TransportEvents[E]>
  ): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        ;(handler as (...a: unknown[]) => void)(...args)
      } catch (err) {
        // One bad subscriber must not stop the others, and must not take down
        // the socket that emitted the event.
        console.error(`transport: handler for "${String(event)}" threw`, err)
      }
    }
  }
}

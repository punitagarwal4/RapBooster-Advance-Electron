/**
 * Preload — the only bridge between renderer and main (CLAUDE.md §2.1).
 *
 * Exposes a narrow, allowlisted surface. The renderer cannot name an arbitrary
 * channel: `invoke` rejects anything outside the contract, so a compromised or
 * buggy renderer cannot reach an IPC handler that was never meant for it.
 */
import { contextBridge, ipcRenderer } from 'electron'
// Value import: plain string arrays, no runtime dependencies. The preload runs
// with `sandbox: true`, where `require` cannot reach node_modules — importing
// the zod contract here would break the bridge entirely.
import { IPC_CHANNELS, IPC_EVENTS } from '../../shared/channels'
// Type-only: erased at compile time, so no zod reaches the sandbox.
import type {
  IpcChannel,
  IpcEvent,
  IpcEventPayload,
  IpcRequest,
  IpcResponse,
  IpcResult,
} from '../../shared/ipc'

const channels = new Set<string>(IPC_CHANNELS)
const events = new Set<string>(IPC_EVENTS)

const api = {
  invoke<C extends IpcChannel>(
    channel: C,
    request?: IpcRequest<C>,
  ): Promise<IpcResult<IpcResponse<C>>> {
    if (!channels.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED' as const,
          userMessage: 'Something went wrong.',
          detail: `Unknown IPC channel: ${channel}`,
        },
      })
    }
    return ipcRenderer.invoke(channel, request)
  },

  /** Subscribe to a push event. Returns an unsubscribe function. */
  on<E extends IpcEvent>(event: E, callback: (payload: IpcEventPayload<E>) => void): () => void {
    if (!events.has(event)) {
      console.error(`Unknown IPC event: ${event}`)
      return () => {}
    }
    // The IpcRendererEvent is deliberately not forwarded — it carries a
    // `sender` the renderer has no business touching.
    const listener = (_e: unknown, payload: IpcEventPayload<E>): void => callback(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  },
}

export type RapBoosterApi = typeof api

contextBridge.exposeInMainWorld('api', api)

/**
 * Central IPC router (SPRINTS.md §5, CLAUDE.md §2.2).
 *
 * Responsibilities, in order:
 *   1. Validate the request against the contract — the renderer is untrusted.
 *   2. Run the handler.
 *   3. Validate the response — a handler returning the wrong shape is a bug and
 *      should fail here, not inside a component three layers away.
 *   4. Map any throw onto the typed error taxonomy and resolve (never reject),
 *      so the renderer always receives a discriminated result.
 */
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { AppError, serializeError } from '../../../shared/errors'
import {
  ipcContract,
  ipcEvents,
  type IpcChannel,
  type IpcEvent,
  type IpcEventPayload,
  type IpcRequest,
  type IpcResponse,
  type IpcResult,
} from '../../../shared/ipc'

export type Handler<C extends IpcChannel> = (
  request: IpcRequest<C>,
  event: IpcMainInvokeEvent,
) => Promise<IpcResponse<C>> | IpcResponse<C>

const registered = new Set<IpcChannel>()

export function registerHandler<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  if (registered.has(channel)) {
    throw new Error(`IPC channel registered twice: ${channel}`)
  }
  registered.add(channel)

  ipcMain.handle(channel, async (event, rawRequest): Promise<IpcResult<IpcResponse<C>>> => {
    const started = Date.now()
    try {
      const spec = ipcContract[channel]

      const parsedRequest = spec.request.safeParse(rawRequest)
      if (!parsedRequest.success) {
        throw new AppError('VALIDATION_FAILED', {
          detail: `${channel} request: ${parsedRequest.error.message}`,
        })
      }

      const result = await handler(parsedRequest.data as IpcRequest<C>, event)

      const parsedResponse = spec.response.safeParse(result)
      if (!parsedResponse.success) {
        // Deliberately loud: this is our own bug, and silently passing a
        // malformed payload to the UI makes it far harder to find later.
        throw new AppError('UNKNOWN', {
          detail: `${channel} response failed validation: ${parsedResponse.error.message}`,
        })
      }

      return { ok: true, data: parsedResponse.data as IpcResponse<C> }
    } catch (err) {
      const error = serializeError(err)
      console.error(`ipc ${channel} failed [${error.code}]`, error.detail ?? error.userMessage)
      return { ok: false, error }
    } finally {
      const ms = Date.now() - started
      if (ms > 250) console.warn(`ipc ${channel} took ${ms}ms`)
    }
  })
}

/** Channels declared in the contract but not yet implemented. */
export function unregisteredChannels(): IpcChannel[] {
  return (Object.keys(ipcContract) as IpcChannel[]).filter((c) => !registered.has(c))
}

/**
 * Emit a push event to every open window. Payloads are validated here too —
 * an event is just as capable of corrupting the UI as a response.
 */
export function emitToAll<E extends IpcEvent>(
  windows: BrowserWindow[],
  event: E,
  payload: IpcEventPayload<E>,
): void {
  const parsed = ipcEvents[event].safeParse(payload)
  if (!parsed.success) {
    console.error(`ipc event ${event} failed validation: ${parsed.error.message}`)
    return
  }
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(event, parsed.data)
  }
}

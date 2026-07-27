'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SerializedError } from '../../shared/errors'
import type {
  IpcChannel,
  IpcEvent,
  IpcEventPayload,
  IpcRequest,
  IpcResponse,
} from '../../shared/ipc'

/**
 * Imperative IPC call. Returns the discriminated result rather than throwing,
 * so call sites handle the typed error taxonomy explicitly instead of wrapping
 * everything in try/catch (CLAUDE.md §5.1).
 */
export function useIpcInvoke() {
  return useCallback(
    async <C extends IpcChannel>(channel: C, request?: IpcRequest<C>) =>
      window.api.invoke(channel, request),
    [],
  )
}

export interface QueryState<T> {
  data: T | undefined
  error: SerializedError | undefined
  loading: boolean
  refetch: () => void
}

interface Settled<T> {
  key: string
  data?: T
  error?: SerializedError
}

/**
 * Read-through query for a single channel.
 *
 * Deliberately minimal: there is no cache, because live data arrives via push
 * events rather than by re-polling (CLAUDE.md §2.7). Anything that must update
 * on its own subscribes with useIpcEvent and calls refetch.
 *
 * `loading` is derived by comparing the settled result's key against the
 * current one rather than being set inside the effect. That avoids a
 * setState-in-effect round trip and, more importantly, means a changed request
 * never briefly renders the previous request's data as if it were current.
 */
export function useIpcQuery<C extends IpcChannel>(
  channel: C,
  request?: IpcRequest<C>,
  options: { enabled?: boolean } = {},
): QueryState<IpcResponse<C>> {
  const { enabled = true } = options
  const [nonce, setNonce] = useState(0)
  const [settled, setSettled] = useState<Settled<IpcResponse<C>>>({ key: '' })

  // Requests are usually object literals, so depending on the value itself
  // would refetch on every render.
  const key = `${channel}:${JSON.stringify(request ?? null)}:${nonce}`

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    void window.api.invoke(channel, request).then((result) => {
      if (cancelled) return
      setSettled(
        result.ok ? { key, data: result.data } : { key, error: result.error },
      )
    })

    return () => {
      cancelled = true
    }
    // `key` already encodes channel, request and nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  const refetch = useCallback(() => setNonce((n) => n + 1), [])
  const isCurrent = settled.key === key

  return {
    data: isCurrent ? settled.data : undefined,
    error: isCurrent ? settled.error : undefined,
    loading: enabled && !isCurrent,
    refetch,
  }
}

/**
 * Subscribe to a push event for the lifetime of the component.
 *
 * The handler is held in a ref, updated in an effect rather than during render,
 * so the subscription is not torn down and rebuilt every time the parent
 * re-renders with a new closure.
 */
export function useIpcEvent<E extends IpcEvent>(
  event: E,
  handler: (payload: IpcEventPayload<E>) => void,
): void {
  const ref = useRef(handler)

  useEffect(() => {
    ref.current = handler
  }, [handler])

  useEffect(() => window.api.on(event, (payload) => ref.current(payload)), [event])
}

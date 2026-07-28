'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '../../lib/cn'
import { useIpcEvent } from '../../hooks/useIpc'

type Level = 'info' | 'success' | 'warning' | 'error'

interface Toast {
  id: number
  level: Level
  message: string
}

const TONES: Record<Level, string> = {
  info: 'bg-surface border-line text-ink',
  success: 'bg-status-ok-bg border-status-ok-fg/20 text-status-ok-fg',
  warning: 'bg-status-warn-bg border-status-warn-fg/20 text-status-warn-fg',
  error: 'bg-danger/10 border-danger/20 text-danger',
}

const ToastContext = createContext<(level: Level, message: string) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 0

/**
 * Toasts surface background work the user did not initiate — a device
 * reconnecting, a campaign finishing, wa-service restarting. Main pushes them
 * over the `toast` event so no screen has to poll for them.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (level: Level, message: string) => {
      const id = nextId++
      setToasts((current) => [...current, { id, level, message }])
      // Errors stay until dismissed; anything else is transient.
      if (level !== 'error') {
        setTimeout(() => dismiss(id), 5000)
      }
    },
    [dismiss],
  )

  useIpcEvent('toast', ({ level, message }) => push(level, message))

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            data-testid="toast"
            className={cn(
              'pointer-events-auto rounded-card border px-3 py-2 text-left text-sm shadow-sm',
              TONES[toast.level],
            )}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

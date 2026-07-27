'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

/**
 * Modal dialog.
 *
 * Hand-written rather than pulled from a component library (see tracker D20),
 * but it still has to behave: Escape closes, focus moves into the dialog on
 * open and returns to the trigger on close, and focus is trapped while open.
 * A modal that lets keyboard focus wander behind it is not accessible.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 500,
  testId,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: number
  testId?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null

    const panel = panelRef.current
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled'))

    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusable()
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6"
      onMouseDown={(event) => {
        // Only a click that both starts and ends on the backdrop dismisses —
        // otherwise a drag that ends outside would close the dialog and lose
        // whatever the user had typed.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        style={{ maxWidth: width }}
        className={cn(
          'flex max-h-[85vh] w-full flex-col rounded-card border border-line bg-surface shadow-lg',
        )}
      >
        <div className="shrink-0 border-b border-line px-5 py-3 text-[13px] font-semibold text-ink">
          {title}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

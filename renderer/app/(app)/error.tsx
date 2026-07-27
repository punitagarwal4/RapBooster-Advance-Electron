'use client'

import { useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'

/**
 * Per-route error boundary (CLAUDE.md §5.1). A render failure must offer a way
 * out rather than leaving a blank window — in a desktop app the user cannot
 * simply reload the page.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Reaches main's log via the console bridge; the renderer has no logger.
    console.error('render error', error)
  }, [error])

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-base font-semibold text-ink">Something went wrong on this screen</h2>
      <p className="max-w-md text-sm text-ink-muted">
        The rest of the application is still running. You can retry this screen, or switch to
        another one from the sidebar.
      </p>
      <Button variant="primary" onClick={reset} data-testid="error-retry">
        Try again
      </Button>
    </div>
  )
}

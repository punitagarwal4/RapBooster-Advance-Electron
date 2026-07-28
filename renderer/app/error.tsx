'use client'

import { useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'

/**
 * Root error boundary.
 *
 * WHY this exists separately from `(app)/error.tsx`: route-segment boundaries
 * only cover their own subtree, and `activation` and `(app)` are sibling route
 * groups — so the application boundary did not protect the activation screen at
 * all. That screen is the one every unlicensed user must pass through before
 * anything else works, and the window has no menu bar or reload control, so an
 * unhandled render error there left the user with a blank window and no way out
 * of an app they had paid for.
 *
 * Deliberately does not depend on the sidebar or any app chrome, because it has
 * to be able to render when the activation screen itself has failed.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Reaches main's log via the console bridge; the renderer has no logger.
    console.error('root render error', error)
  }, [error])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-app-bg px-6 text-center">
      <h2 className="text-base font-semibold text-ink">Something went wrong</h2>
      <p className="max-w-md text-sm text-ink-muted">
        The application hit an unexpected error and could not continue. Trying again is
        usually enough; if it keeps happening, restart the application.
      </p>
      <Button variant="primary" onClick={reset} data-testid="error-retry">
        Try again
      </Button>
    </div>
  )
}

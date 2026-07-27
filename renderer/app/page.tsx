'use client'

/**
 * Placeholder dashboard. The real app shell — sidebar, routing and the nine
 * screens — lands in T1.7; the design system it depends on lands in T1.6.
 * This page exists so the static export and the Electron load path can be
 * verified end to end before either of those.
 */
export default function DashboardPage() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3">
      <h1 className="text-2xl font-semibold text-ink">RapBooster Advance</h1>
      <p className="text-ink-muted">Sprint 1 — foundation in progress.</p>
      <span
        data-testid="renderer-ready"
        className="rounded-card bg-status-ok-bg px-3 py-1 text-sm text-status-ok-fg"
      >
        Renderer loaded
      </span>
    </main>
  )
}

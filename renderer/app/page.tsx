'use client'

import { useIpcQuery } from '../hooks/useIpc'

/**
 * Placeholder dashboard. The real app shell — sidebar, routing and the nine
 * screens — lands in T1.7; the design system it depends on lands in T1.6.
 *
 * It reads live data over IPC rather than showing static text, so the contract,
 * the router, the preload bridge and the database are all exercised end to end
 * by simply opening the app.
 */
export default function DashboardPage() {
  const version = useIpcQuery('system:version')
  const stats = useIpcQuery('system:dashboard')

  return (
    <main className="flex h-full flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold text-ink">RapBooster Advance</h1>
      <p className="text-ink-muted">Sprint 1 — foundation in progress.</p>

      {version.data && (
        <p className="text-sm text-ink-subtle" data-testid="version-info">
          v{version.data.app} · Electron {version.data.electron} · {version.data.platform}
        </p>
      )}

      {stats.data && (
        <dl className="grid grid-cols-2 gap-3" data-testid="dashboard-stats">
          {(
            [
              ['Total Contacts', stats.data.totalContacts],
              ['Active Devices', stats.data.activeDevices],
              ['Running Campaigns', stats.data.runningCampaigns],
              ['Templates', stats.data.templates],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="rounded-card border border-line bg-surface px-4 py-3 text-center"
            >
              <dt className="text-xs text-ink-muted">{label}</dt>
              <dd className="text-2xl font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {stats.error && (
        <p className="text-sm text-danger" role="alert">
          {stats.error.userMessage}
        </p>
      )}

      <span
        data-testid="renderer-ready"
        className="rounded-card bg-status-ok-bg px-3 py-1 text-sm text-status-ok-fg"
      >
        Renderer loaded
      </span>
    </main>
  )
}

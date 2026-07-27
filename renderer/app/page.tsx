'use client'

import { PageHeader } from '../components/layout/page-header'
import { useIpcQuery } from '../hooks/useIpc'

function StatCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-ink">
        {loading ? <span className="text-ink-subtle">—</span> : value}
      </dd>
    </div>
  )
}

/**
 * Dashboard. The prototype's four stat cards, with real aggregates rather than
 * its hardcoded numbers. Definitions come from REQUIREMENTS §7.1.
 */
export default function DashboardPage() {
  const stats = useIpcQuery('system:dashboard')
  const loading = stats.loading

  const cards = [
    { label: 'Total Contacts', value: stats.data?.totalContacts ?? 0 },
    { label: 'Active Devices', value: stats.data?.activeDevices ?? 0 },
    { label: 'Running Campaigns', value: stats.data?.runningCampaigns ?? 0 },
    { label: 'Templates', value: stats.data?.templates ?? 0 },
  ]

  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="flex-1 p-6">
        {stats.error ? (
          <p className="text-sm text-danger" role="alert">
            {stats.error.userMessage}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="dashboard-stats">
              {cards.map((card) => (
                <StatCard key={card.label} {...card} loading={loading} />
              ))}
            </dl>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <StatCard label="Sent today" value={stats.data?.sentToday ?? 0} loading={loading} />
              <StatCard
                label="Failed today"
                value={stats.data?.failedToday ?? 0}
                loading={loading}
              />
            </div>
          </>
        )}
        <span data-testid="renderer-ready" className="sr-only">
          Renderer loaded
        </span>
      </div>
    </>
  )
}

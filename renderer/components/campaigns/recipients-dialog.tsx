'use client'

import { useEffect, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/cn'
import type { RecipientStatus } from '@shared/types'

interface Recipient {
  id: string
  phone: string
  contactName: string
  status: RecipientStatus
  attempts: number
  error: string | null
  sentAt: string | null
}

const FILTERS: Array<{ value: RecipientStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
]

const TONE: Record<RecipientStatus, string> = {
  sent: 'text-success',
  failed: 'text-danger',
  pending: 'text-ink-muted',
  sending: 'text-status-warn-fg',
  skipped: 'text-ink-subtle',
}

/**
 * Per-recipient outcomes for one campaign.
 *
 * A dialog rather than a `/campaigns/[id]` route: the renderer is a static
 * export, and a dynamic segment would need its parameters known at build time
 * — which campaign ids are not. Recorded as a deviation from SPRINTS §11.1 T3.5.
 *
 * This is the first thing anyone asks for when a campaign underperforms, and
 * the queue makes it nearly free.
 */
export function RecipientsDialog({
  campaignId,
  campaignName,
  onClose,
}: {
  campaignId: string
  campaignName: string
  onClose: () => void
}) {
  const [filter, setFilter] = useState<RecipientStatus | 'all'>('all')
  const [page, setPage] = useState<{
    key: string
    rows: Recipient[]
    total: number
    cursor: string | null
  }>({ key: '', rows: [], total: 0, cursor: null })
  const [loadingMore, setLoadingMore] = useState(false)

  const key = `${campaignId}|${filter}`
  // Derived rather than set inside the effect: a synchronous setState there
  // causes a cascading render, and comparing keys also stops the previous
  // filter's rows showing briefly as if they were the new result.
  const loading = page.key !== key

  useEffect(() => {
    let cancelled = false

    void window.api
      .invoke('campaign:recipients', {
        id: campaignId,
        ...(filter === 'all' ? {} : { status: filter }),
        limit: 200,
      })
      .then((result) => {
        if (cancelled) return
        setPage({
          key,
          rows: result.ok ? result.data.items : [],
          total: result.ok ? result.data.total : 0,
          cursor: result.ok ? result.data.nextCursor : null,
        })
      })

    return () => {
      cancelled = true
    }
    // `key` encodes both inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  async function loadMore() {
    if (!page.cursor) return
    setLoadingMore(true)
    const result = await window.api.invoke('campaign:recipients', {
      id: campaignId,
      ...(filter === 'all' ? {} : { status: filter }),
      cursor: page.cursor,
      limit: 200,
    })
    setLoadingMore(false)
    if (result.ok) {
      setPage((current) => ({
        ...current,
        rows: [...current.rows, ...result.data.items],
        cursor: result.data.nextCursor,
      }))
    }
  }

  const { rows, total, cursor } = page

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Recipients — ${campaignName}`}
      testId="recipients-dialog"
      width={720}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            data-testid={`recipient-filter-${f.value}`}
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-control px-2.5 py-1 text-xs',
              filter === f.value
                ? 'bg-primary text-white'
                : 'border border-line text-ink hover:bg-wa-in',
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-muted" data-testid="recipient-total">
          {total.toLocaleString()} shown
        </span>
      </div>

      {rows.length === 0 && !loading ? (
        <p className="py-6 text-center text-sm text-ink-muted">No recipients match that filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-xs">
            <thead className="bg-app-bg">
              <tr>
                {['Phone', 'Name', 'Status', 'Tries', 'Sent', 'Error'].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-medium text-ink-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line" data-testid="recipient-row">
                  <td className="px-2 py-1.5 font-mono text-ink">{r.phone}</td>
                  <td className="max-w-32 truncate px-2 py-1.5 text-ink">{r.contactName}</td>
                  <td className={cn('px-2 py-1.5 font-medium', TONE[r.status])}>{r.status}</td>
                  <td className="px-2 py-1.5 text-ink">{r.attempts}</td>
                  <td className="px-2 py-1.5 text-ink-muted">
                    {r.sentAt ? new Date(r.sentAt).toLocaleTimeString() : '—'}
                  </td>
                  <td className="max-w-48 truncate px-2 py-1.5 text-danger" title={r.error ?? ''}>
                    {r.error ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && (
        <Button className="mt-3" onClick={() => void loadMore()} disabled={loading}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </Dialog>
  )
}

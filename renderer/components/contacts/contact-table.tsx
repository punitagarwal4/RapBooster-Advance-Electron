'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/cn'

interface Contact {
  id: string
  name: string
  phone: string
  data: Record<string, string>
  isValid: boolean
}

const PAGE_SIZE = 200
const ROW_HEIGHT = 36

/**
 * Virtualized, cursor-paginated contact table.
 *
 * Only the visible rows are in the DOM and only the fetched pages are in
 * memory. Rendering 50,000 <tr> elements would lock the renderer for seconds
 * and hold far more memory than the data itself (CLAUDE.md §5.7).
 */
export function ContactTable({
  listId,
  fields,
  search,
  onDelete,
  reloadKey,
}: {
  listId: string
  fields: string[]
  search: string
  onDelete: (id: string) => void
  reloadKey: number
}) {
  const [rows, setRows] = useState<Contact[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // A changed list, search or reload key invalidates everything fetched so far.
  const queryKey = `${listId}|${search}|${reloadKey}`
  const loadedKey = useRef('')

  useEffect(() => {
    let cancelled = false

    void window.api
      .invoke('contacts:list', { listId, search: search || undefined, limit: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        loadedKey.current = queryKey
        if (result.ok) {
          setRows(result.data.items)
          setCursor(result.data.nextCursor)
          setTotal(result.data.total)
        } else {
          setRows([])
          setCursor(null)
          setTotal(0)
        }
        scrollRef.current?.scrollTo({ top: 0 })
      })

    return () => {
      cancelled = true
    }
    // queryKey encodes every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const items = virtualizer.getVirtualItems()
  const last = items[items.length - 1]

  // Fetch the next page as the user approaches the end of what is loaded.
  useEffect(() => {
    if (!last || loading || cursor === null) return
    if (last.index < rows.length - 20) return

    setLoading(true)
    void window.api
      .invoke('contacts:list', {
        listId,
        search: search || undefined,
        cursor,
        limit: PAGE_SIZE,
      })
      .then((result) => {
        if (result.ok && loadedKey.current === queryKey) {
          setRows((current) => [...current, ...result.data.items])
          setCursor(result.data.nextCursor)
        }
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.index, cursor, loading, rows.length])

  if (total === 0) {
    return (
      <p className="p-6 text-sm text-ink-muted" data-testid="contacts-empty">
        {search ? 'No contacts match that search.' : 'This list has no contacts yet.'}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-6 py-2 text-xs text-ink-muted">
        <span data-testid="contacts-total">
          {total.toLocaleString()} contact{total === 1 ? '' : 's'}
        </span>
        <span>{rows.length.toLocaleString()} loaded</span>
      </div>

      <div className="flex gap-2 border-b border-line bg-app-bg px-6 py-1.5 text-xs font-medium text-ink-muted">
        {fields.map((field) => (
          <span key={field} className="min-w-0 flex-1 truncate">
            {field}
          </span>
        ))}
        <span className="w-16 shrink-0 text-right">Actions</span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="contacts-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((item) => {
            const contact = rows[item.index]
            if (!contact) return null
            return (
              <div
                key={contact.id}
                data-testid="contact-row"
                className={cn(
                  'absolute left-0 flex w-full items-center gap-2 border-b border-line px-6 text-sm',
                  !contact.isValid && 'bg-status-warn-bg',
                )}
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                {fields.map((field) => (
                  <span key={field} className="min-w-0 flex-1 truncate text-ink">
                    {contact.data[field] ?? ''}
                  </span>
                ))}
                <span className="w-16 shrink-0 text-right">
                  <Button size="sm" variant="danger" onClick={() => onDelete(contact.id)}>
                    Delete
                  </Button>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

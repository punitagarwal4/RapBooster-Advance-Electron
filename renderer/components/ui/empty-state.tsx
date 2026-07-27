'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Every screen ships a real empty state rather than a blank panel — an empty
 * screen with no explanation reads as a broken app.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="rounded-full bg-wa-in p-3">
        <Icon className="size-6 text-ink-subtle" aria-hidden />
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      {action}
    </div>
  )
}

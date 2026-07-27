'use client'

import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { FOOTER_NAV, PRIMARY_NAV, type NavItem } from './nav'

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      data-testid={item.testId}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 border-l-[3px] px-3 py-2 text-sm transition-colors',
        active
          ? 'border-primary bg-wa-in font-medium text-ink'
          : 'border-transparent text-ink-muted hover:bg-wa-in hover:text-ink',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

/**
 * Application chrome: a fixed 200px sidebar (matching the prototype) beside a
 * scrollable content column with a custom frameless title bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // useSelectedLayoutSegment is the API intended for highlighting nav inside a
  // persisted layout. usePathname does not reliably update here on client-side
  // navigation in a static export, which left every item marked active at once.
  const segment = useSelectedLayoutSegment()
  const isActive = (item: NavItem) => item.segment === segment

  return (
    <div className="flex h-full">
      <nav
        aria-label="Main"
        className="flex w-[200px] shrink-0 flex-col border-r border-line bg-sidebar"
      >
        <div className="app-drag h-9 shrink-0" />
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-1">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item)} />
          ))}
        </div>
        <div className="border-t border-line py-1">
          {FOOTER_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item)} />
          ))}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* The only draggable region — everything else must stay clickable. */}
        <header className="app-drag flex h-9 shrink-0 items-center justify-center border-b border-line bg-surface text-[13px] font-semibold text-ink">
          RapBooster Advance
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

'use client'

import { cn } from '../../lib/cn'
import type { CampaignStatus, DeviceStatus } from '@shared/types'

/**
 * Status colours come straight from the prototype (SPRINTS.md §7): green for
 * healthy, amber for paused, grey for idle, red for terminal failure.
 */
type Tone = 'ok' | 'warn' | 'idle' | 'danger'

const TONES: Record<Tone, string> = {
  ok: 'bg-status-ok-bg text-status-ok-fg',
  warn: 'bg-status-warn-bg text-status-warn-fg',
  idle: 'bg-status-idle-bg text-status-idle-fg',
  danger: 'bg-danger/10 text-danger',
}

const DEVICE_TONES: Record<DeviceStatus, Tone> = {
  connected: 'ok',
  connecting: 'warn',
  qr_pending: 'warn',
  pairing_pending: 'warn',
  disconnected: 'idle',
  logged_out: 'danger',
  banned: 'danger',
}

const DEVICE_LABELS: Record<DeviceStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  qr_pending: 'Awaiting scan',
  pairing_pending: 'Awaiting code',
  disconnected: 'Disconnected',
  logged_out: 'Logged out',
  banned: 'Banned',
}

const CAMPAIGN_TONES: Record<CampaignStatus, Tone> = {
  running: 'ok',
  scheduled: 'warn',
  paused: 'warn',
  draft: 'idle',
  completed: 'idle',
  failed: 'danger',
}

export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

export function DeviceStatusPill({ status }: { status: DeviceStatus }) {
  return <StatusPill tone={DEVICE_TONES[status]}>{DEVICE_LABELS[status]}</StatusPill>
}

export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  return (
    <StatusPill tone={CAMPAIGN_TONES[status]}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </StatusPill>
  )
}

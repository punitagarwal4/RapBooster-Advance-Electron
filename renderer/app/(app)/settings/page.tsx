'use client'

import { useState, type ReactNode } from 'react'
import { PageHeader } from '@renderer/components/layout/page-header'
import { useToast } from '@renderer/components/providers/toast-provider'
import { Button } from '@renderer/components/ui/button'
import { StatusPill } from '@renderer/components/ui/status-pill'
import { useIpcQuery } from '@renderer/hooks/useIpc'
import type { LicenseStatus } from '@shared/types'

const STATUS_TONE: Record<LicenseStatus, 'ok' | 'warn' | 'idle' | 'danger'> = {
  valid: 'ok',
  grace: 'warn',
  conflict: 'warn',
  unlicensed: 'idle',
  invalid: 'danger',
  expired: 'danger',
  revoked: 'danger',
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Settings. The license panel is T1.9; AI configuration, sending defaults and
 * backup/restore land in T4.3.
 */
export default function SettingsPage() {
  const license = useIpcQuery('license:status')
  const paths = useIpcQuery('system:paths')
  const version = useIpcQuery('system:version')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function deactivate() {
    setBusy(true)
    const result = await window.api.invoke('license:deactivate')
    setBusy(false)
    setConfirming(false)
    if (!result.ok) toast('error', result.error.userMessage)
    // On success main swaps the window back to activation, so there is nothing
    // left to render here.
  }

  async function revalidate() {
    setBusy(true)
    const result = await window.api.invoke('license:revalidate')
    setBusy(false)
    if (result.ok) {
      toast('success', `License re-checked: ${result.data.status}`)
      license.refetch()
    } else {
      toast('error', result.error.userMessage)
    }
  }

  async function exportDiagnostics() {
    setBusy(true)
    const result = await window.api.invoke('system:exportDiagnostics')
    setBusy(false)
    if (result.ok) {
      toast('success', 'Diagnostics exported')
      await window.api.invoke('system:openPath', { path: result.data.filePath })
    } else {
      toast('error', result.error.userMessage)
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="License, data and diagnostics." />

      <div className="flex flex-col gap-4 p-6">
        <Section title="License">
          <dl data-testid="license-panel">
            <Row label="Status">
              {license.data ? (
                <StatusPill tone={STATUS_TONE[license.data.status]}>
                  {license.data.status}
                </StatusPill>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Key">
              <span className="font-mono text-xs" data-testid="license-key-masked">
                {license.data?.keyMasked ?? '—'}
              </span>
            </Row>
            <Row label="Bound device">{license.data?.deviceName ?? '—'}</Row>
            <Row label="Remarks">{license.data?.remarks ?? '—'}</Row>
            <Row label="Activated">{formatDate(license.data?.activatedAt)}</Row>
            <Row label="Expires">{formatDate(license.data?.expiresAt)}</Row>
            <Row label="Last checked">{formatDate(license.data?.lastValidatedAt)}</Row>
            {license.data?.graceUntil && (
              <Row label="Offline grace until">{formatDate(license.data.graceUntil)}</Row>
            )}
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={revalidate} disabled={busy} data-testid="license-revalidate">
              Re-check now
            </Button>
            {confirming ? (
              <>
                <span className="text-sm text-ink-muted">
                  This releases the license from this computer.
                </span>
                <Button
                  variant="danger"
                  onClick={deactivate}
                  disabled={busy}
                  data-testid="license-deactivate-confirm"
                >
                  Confirm
                </Button>
                <Button onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="danger"
                onClick={() => setConfirming(true)}
                disabled={busy}
                data-testid="license-deactivate"
              >
                Deactivate this device
              </Button>
            )}
          </div>
        </Section>

        <Section title="Data &amp; diagnostics">
          <dl>
            <Row label="Database">
              <span className="font-mono text-xs">{paths.data?.database ?? '—'}</span>
            </Row>
            <Row label="Logs">
              <span className="font-mono text-xs">{paths.data?.logs ?? '—'}</span>
            </Row>
            <Row label="Version">
              {version.data
                ? `${version.data.app} · Electron ${version.data.electron} · ${version.data.platform}`
                : '—'}
            </Row>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => {
                if (paths.data) void window.api.invoke('system:openPath', { path: paths.data.logs })
              }}
              disabled={!paths.data}
            >
              Open logs folder
            </Button>
            <Button onClick={exportDiagnostics} disabled={busy} data-testid="export-diagnostics">
              Export diagnostics
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Diagnostics contain no message content; phone numbers and keys are redacted.
          </p>
        </Section>

        <Section title="Coming in later sprints">
          <p className="text-sm text-ink-muted">
            AI configuration, sending defaults, and backup &amp; restore arrive with T4.3.
          </p>
        </Section>
      </div>
    </>
  )
}

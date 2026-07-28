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
  const defaults = useIpcQuery('settings:getSendingDefaults')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [clearConfirm, setClearConfirm] = useState('')

  // Edits overlay the loaded values rather than being copied in by an effect —
  // see the AI Bot screen for the same pattern and reasoning.
  const [sendingEdits, setSendingEdits] = useState<NonNullable<typeof defaults.data>>()

  async function saveDefaults() {
    const next = sendingEdits ?? defaults.data
    if (!next) return
    setBusy(true)
    const result = await window.api.invoke('settings:setSendingDefaults', next)
    setBusy(false)
    if (!result.ok) {
      toast('error', result.error.userMessage)
      return
    }
    setSendingEdits(undefined)
    defaults.refetch()
    toast('success', 'Sending defaults saved')
  }

  async function backupNow() {
    setBusy(true)
    const result = await window.api.invoke('system:backup')
    setBusy(false)
    if (!result.ok) {
      toast('error', result.error.userMessage)
      return
    }
    toast('success', 'Backup created')
    await window.api.invoke('system:openPath', { path: result.data.filePath })
  }

  async function clearData() {
    setBusy(true)
    const result = await window.api.invoke('system:clearData', { confirmation: 'DELETE' })
    setBusy(false)
    setClearConfirm('')
    if (!result.ok) {
      toast('error', result.error.userMessage)
      return
    }
    toast('success', 'All data cleared. A backup was saved first.')
  }

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

  // Hoisted so the narrowing is provable inside JSX rather than asserted.
  const sending = sendingEdits ?? defaults.data

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
                if (paths.data)
                  void window.api.invoke('system:openPath', { path: paths.data.logs })
              }}
              disabled={!paths.data}
            >
              Open logs folder
            </Button>
            <Button
              onClick={exportDiagnostics}
              disabled={busy}
              data-testid="export-diagnostics"
            >
              Export diagnostics
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Diagnostics contain no message content; phone numbers and keys are redacted.
          </p>
        </Section>

        <Section title="Sending defaults">
          <p className="mb-2 text-xs text-ink-muted">
            Applied to new campaigns. Existing campaigns keep the pacing they were created
            with — changing a running campaign&rsquo;s rhythm mid-send is exactly what
            gets accounts flagged.
          </p>

          {sending && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['Delay from (sec)', 'delayFrom', 0, 300],
                    ['Delay to (sec)', 'delayTo', 0, 300],
                    ['Sleep duration (sec)', 'sleepDuration', 0, 600],
                    ['Sleep after N messages', 'sleepAfter', 1, 100],
                    ['Group message delay (sec)', 'groupMessageDelay', 0, 300],
                    ['Group create delay (sec)', 'groupCreateDelay', 0, 60],
                    ['Daily cap per device (0 = none)', 'dailyCapPerDevice', 0, 100000],
                    ['Retry attempts', 'retryAttempts', 0, 10],
                    ['Max concurrent devices', 'maxConcurrentDevices', 1, 20],
                  ] as const
                ).map(([label, key, min, max]) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label
                      htmlFor={`sd-${key}`}
                      className="text-xs font-semibold text-ink"
                    >
                      {label}
                    </label>
                    <input
                      id={`sd-${key}`}
                      data-testid={`sd-${key}`}
                      type="number"
                      min={min}
                      max={max}
                      value={sending[key]}
                      onChange={(e) =>
                        setSendingEdits({
                          ...sending,
                          [key]: Number(e.target.value),
                        })
                      }
                      className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                ))}
              </div>
              <Button
                className="mt-3"
                variant="primary"
                onClick={saveDefaults}
                disabled={busy}
                data-testid="save-sending-defaults"
              >
                Save sending defaults
              </Button>
            </>
          )}
        </Section>

        <Section title="Backup &amp; restore">
          <p className="mb-2 text-xs text-ink-muted">
            A backup is taken automatically before every migration, restore, and clear.
            These are snapshots of the whole database — contacts, templates, campaigns and
            message history.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={backupNow} disabled={busy} data-testid="backup-now">
              Back up now
            </Button>
            <Button
              onClick={() => {
                if (paths.data) {
                  void window.api.invoke('system:openPath', {
                    path: paths.data.database.replace(/rapbooster\.db$/, 'backups'),
                  })
                }
              }}
              disabled={!paths.data}
              data-testid="open-backups"
            >
              Open backups folder
            </Button>
          </div>

          <div className="mt-4 rounded-card border border-danger/20 bg-danger/5 p-3">
            <p className="text-xs font-semibold text-danger">Clear all data</p>
            <p className="mt-1 text-xs text-ink-muted">
              Removes every contact, template, campaign, group and message. Devices and
              your license are kept. A backup is taken first, so this is recoverable — but
              only from that backup.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={clearConfirm}
                onChange={(e) => setClearConfirm(e.target.value)}
                placeholder="Type DELETE to confirm"
                data-testid="clear-confirm"
                className="w-48 rounded-control border border-line px-2.5 py-1.5 text-sm outline-none focus:border-danger"
              />
              <Button
                variant="danger"
                onClick={clearData}
                disabled={busy || clearConfirm !== 'DELETE'}
                data-testid="clear-data"
              >
                Clear all data
              </Button>
            </div>
          </div>
        </Section>
      </div>
    </>
  )
}

'use client'

import { useState, type FormEvent } from 'react'
import type { SerializedError } from '@shared/errors'
import type { LicenseStatus } from '@shared/types'
import { Button } from '@renderer/components/ui/button'

interface Conflict {
  deviceName: string
  lastUsedAt: string | null
}

/** "2 days ago" — the prototype's conflict dialog shows a relative time. */
function relativeTime(iso: string | null): string {
  if (!iso) return 'unknown'
  const diffMs = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return 'just now'
}

const REJECTION_COPY: Partial<Record<LicenseStatus, string>> = {
  invalid: 'Invalid license key. Please check and try again.',
  expired: 'This license has expired.',
  revoked: 'This license has been revoked.',
}

/**
 * License activation. Fields and copy follow the prototype
 * (SPRINTS.md §2.0 / §2.0b).
 */
export default function ActivationPage() {
  const [key, setKey] = useState('')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()
  const [conflict, setConflict] = useState<Conflict>()

  const fail = (err: SerializedError) => setError(err.userMessage)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(undefined)
    setSuccess(undefined)

    if (key.trim() === '') {
      setError('License key is required.')
      return
    }

    setBusy(true)
    const result = await window.api.invoke('license:activate', {
      key: key.trim(),
      remarks: remarks.trim() === '' ? undefined : remarks.trim(),
    })
    setBusy(false)

    if (!result.ok) {
      fail(result.error)
      return
    }

    if (result.data.status === 'conflict' && result.data.conflict) {
      setConflict(result.data.conflict)
      setError('⚠ License conflict detected (key in use elsewhere)')
      return
    }

    if (result.data.status === 'valid') {
      setSuccess('✓ Valid license key')
      // Main swaps the window to the application once activation succeeds.
      await window.api.invoke('license:status')
      return
    }

    setError(REJECTION_COPY[result.data.status] ?? 'Invalid license key. Please check and try again.')
  }

  async function doTransfer() {
    setBusy(true)
    setError(undefined)
    const result = await window.api.invoke('license:transfer', {
      key: key.trim(),
      remarks: remarks.trim() === '' ? undefined : remarks.trim(),
    })
    setBusy(false)
    setConflict(undefined)

    if (!result.ok) {
      fail(result.error)
      return
    }
    if (result.data.status === 'valid') {
      setSuccess('✓ Valid license key')
      await window.api.invoke('license:status')
      return
    }
    setError(REJECTION_COPY[result.data.status] ?? 'The license could not be moved.')
  }

  return (
    <div className="flex h-full items-center justify-center bg-app-bg p-6">
      <div className="w-full max-w-[500px] rounded-card border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-5 py-3 text-[13px] font-semibold text-ink">
          Activate License
        </div>

        <form className="flex flex-col gap-4 p-5" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="license-key" className="text-xs font-semibold text-ink">
              License Key <span className="text-danger">*</span>
            </label>
            <input
              id="license-key"
              data-testid="license-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter your license key here"
              autoFocus
              className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="license-remarks" className="text-xs font-semibold text-ink">
              Remarks (optional)
            </label>
            <textarea
              id="license-remarks"
              data-testid="license-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Add any remarks or notes..."
              className="min-h-20 resize-y rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {error && (
            <p className="text-xs text-danger" role="alert" data-testid="license-error">
              {error}
            </p>
          )}
          {success && (
            <p className="text-xs text-success" data-testid="license-success">
              {success}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={busy} data-testid="license-activate">
            {busy ? 'Activating…' : 'Activate'}
          </Button>
        </form>
      </div>

      {conflict && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="conflict-title"
            data-testid="license-conflict-dialog"
            className="w-full max-w-[400px] rounded-card border border-line bg-surface shadow-lg"
          >
            <div
              id="conflict-title"
              className="border-b border-line px-5 py-3 text-[13px] font-semibold text-ink"
            >
              License Already Active
            </div>
            <div className="flex flex-col gap-3 p-5 text-sm text-ink">
              <p>This license key is already activated on another system.</p>
              <p className="rounded-card bg-app-bg px-3 py-2 text-xs" data-testid="conflict-device">
                <strong>Device:</strong> {conflict.deviceName} (Last used:{' '}
                {relativeTime(conflict.lastUsedAt)})
              </p>
              <p>
                Would you like to deactivate the license on the other system and activate it here?
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  onClick={() => {
                    setConflict(undefined)
                    setError(undefined)
                  }}
                  data-testid="conflict-cancel"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={doTransfer}
                  disabled={busy}
                  data-testid="conflict-transfer"
                >
                  Deactivate &amp; Activate Here
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

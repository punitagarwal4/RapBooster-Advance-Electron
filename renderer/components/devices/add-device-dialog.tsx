'use client'

import { useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { useIpcEvent } from '@renderer/hooks/useIpc'
import { cn } from '@renderer/lib/cn'

type Mode = 'qr' | 'pairing'

/**
 * Add-device flow. Instructions and layout follow the prototype
 * (SPRINTS.md §2.5); the pairing-code tab is the addition agreed with the
 * customer, since a machine without a phone camera nearby cannot scan.
 */
/**
 * The caller mounts this only while open, so every attempt starts from a clean
 * slate. Resetting state in an effect instead would leave a window where the
 * previous attempt's values were still rendered.
 */
export function AddDeviceDialog({
  onClose,
  onConnected,
}: {
  onClose: () => void
  onConnected: () => void
}) {
  const [mode, setMode] = useState<Mode>('qr')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [deviceId, setDeviceId] = useState<string>()
  const [pairingCode, setPairingCode] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useIpcEvent('device:qr', ({ deviceId: id, qr }) => {
    if (id !== deviceId || !canvasRef.current) return
    // The QR rotates roughly every 20 seconds; redrawing on each event keeps
    // the displayed code the one WhatsApp will actually accept.
    void QRCode.toCanvas(canvasRef.current, qr, { width: 200, margin: 1 })
  })

  useIpcEvent('device:pairingCode', ({ deviceId: id, code }) => {
    if (id === deviceId) setPairingCode(code)
  })

  useIpcEvent('device:status', ({ deviceId: id, status }) => {
    if (id !== deviceId) return
    if (status === 'connected') {
      onConnected()
      onClose()
    }
  })

  async function createAndConnect(): Promise<string | undefined> {
    if (name.trim() === '') {
      setError('Device name is required.')
      return undefined
    }
    setBusy(true)
    setError(undefined)

    const created = await window.api.invoke('device:create', { name: name.trim() })
    if (!created.ok) {
      setBusy(false)
      setError(created.error.userMessage)
      return undefined
    }

    const connected = await window.api.invoke('device:connect', { id: created.data.id })
    setBusy(false)
    if (!connected.ok) {
      setError(connected.error.userMessage)
      return undefined
    }

    setDeviceId(created.data.id)
    return created.data.id
  }

  async function startPairing() {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 8) {
      setError('Enter the full phone number including country code.')
      return
    }

    const id = deviceId ?? (await createAndConnect())
    if (!id) return

    setBusy(true)
    const result = await window.api.invoke('device:requestPairingCode', {
      id,
      phone: digits,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.userMessage)
      return
    }
    setPairingCode(result.data.code)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add WhatsApp Device"
      testId="add-device-dialog"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {mode === 'qr' ? (
            <Button
              variant="primary"
              onClick={() => void createAndConnect()}
              disabled={busy || deviceId !== undefined}
              data-testid="generate-qr"
            >
              {busy ? 'Connecting…' : 'Generate QR & Connect'}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void startPairing()}
              disabled={busy}
              data-testid="request-pairing-code"
            >
              {busy ? 'Requesting…' : 'Get pairing code'}
            </Button>
          )}
        </>
      }
    >
      <ol className="mb-4 list-decimal space-y-1 rounded-card bg-app-bg p-3 pl-7 text-xs text-ink-muted">
        <li>Open WhatsApp on your phone</li>
        <li>
          Go to <strong>Settings</strong> → <strong>Linked Devices</strong>
        </li>
        <li>
          Tap <strong>Link a Device</strong>
        </li>
        <li>
          {mode === 'qr'
            ? 'Point your phone at the QR code below to scan'
            : 'Choose “Link with phone number instead” and enter the code below'}
        </li>
        <li>Confirm the device name and allow access</li>
      </ol>

      <div className="mb-4 flex flex-col gap-1.5">
        <label htmlFor="device-name" className="text-xs font-semibold text-ink">
          Device Name <span className="text-danger">*</span>
        </label>
        <input
          id="device-name"
          data-testid="device-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={deviceId !== undefined}
          placeholder="e.g., Main Device, Office PC"
          className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary disabled:bg-app-bg"
        />
      </div>

      <div className="mb-3 flex gap-1 border-b border-line" role="tablist">
        {(['qr', 'pairing'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            data-testid={`tab-${value}`}
            onClick={() => setMode(value)}
            className={cn(
              'px-3 py-1.5 text-sm',
              mode === value
                ? 'border-b-2 border-primary font-medium text-ink'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {value === 'qr' ? 'QR code' : 'Pairing code'}
          </button>
        ))}
      </div>

      {mode === 'qr' ? (
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-ink-muted">QR Code (Scan with WhatsApp)</span>
          <canvas
            ref={canvasRef}
            data-testid="qr-canvas"
            width={200}
            height={200}
            className="rounded-card border border-dashed border-line bg-white"
          />
          {deviceId === undefined && (
            <span className="text-xs text-ink-subtle">
              The code appears once you press Generate.
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="pairing-phone" className="text-xs font-semibold text-ink">
            Phone number (with country code)
          </label>
          <input
            id="pairing-phone"
            data-testid="pairing-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
          />
          {pairingCode && (
            <div className="flex items-center justify-between rounded-card bg-app-bg px-3 py-2">
              <span
                className="font-mono text-xl tracking-[0.3em] text-ink"
                data-testid="pairing-code"
              >
                {pairingCode}
              </span>
              <Button
                size="sm"
                onClick={() => void navigator.clipboard.writeText(pairingCode)}
              >
                Copy
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p
          className="mt-3 text-xs text-danger"
          role="alert"
          data-testid="add-device-error"
        >
          {error}
        </p>
      )}
    </Dialog>
  )
}

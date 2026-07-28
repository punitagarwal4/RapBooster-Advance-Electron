'use client'

import { formatDistanceToNow } from 'date-fns'
import { Smartphone } from 'lucide-react'
import { useState } from 'react'
import { AddDeviceDialog } from '@renderer/components/devices/add-device-dialog'
import { PageHeader } from '@renderer/components/layout/page-header'
import { useToast } from '@renderer/components/providers/toast-provider'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { DeviceStatusPill } from '@renderer/components/ui/status-pill'
import { useIpcEvent, useIpcQuery } from '@renderer/hooks/useIpc'
import { MAX_DEVICES } from '@shared/types'

function relative(iso: string | null): string {
  if (!iso) return 'never'
  return `${formatDistanceToNow(new Date(iso))} ago`
}

export default function DevicesPage() {
  const devices = useIpcQuery('device:list')
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState<string>()
  const [busyId, setBusyId] = useState<string>()

  // Status arrives as a push event, so the list stays live without polling.
  useIpcEvent('device:status', () => devices.refetch())

  async function run(id: string, action: 'device:reconnect' | 'device:logout') {
    setBusyId(id)
    const result = await window.api.invoke(action, { id })
    setBusyId(undefined)
    setConfirmLogout(undefined)
    if (!result.ok) toast('error', result.error.userMessage)
    devices.refetch()
  }

  const list = devices.data ?? []
  const atLimit = list.length >= MAX_DEVICES

  return (
    <>
      <PageHeader
        title="WhatsApp Devices"
        description={`Link WhatsApp accounts by QR code or pairing code. ${list.length} of ${MAX_DEVICES} used.`}
        actions={
          <Button
            variant="primary"
            onClick={() => setAdding(true)}
            disabled={atLimit}
            data-testid="add-device"
          >
            + Add Device
          </Button>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title="No devices linked yet."
          description="Link a WhatsApp account to start sending. You can connect up to 20."
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              + Add Device
            </Button>
          }
        />
      ) : (
        <div
          className="grid gap-4 p-6 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]"
          data-testid="device-grid"
        >
          {list.map((device) => (
            <div
              key={device.id}
              data-testid="device-card"
              className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{device.name}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {device.phone ?? 'Not linked'}
                  </p>
                </div>
                <DeviceStatusPill status={device.status} />
              </div>

              <dl className="text-xs text-ink-muted">
                <div className="flex justify-between">
                  <dt>Added</dt>
                  <dd>{new Date(device.createdAt).toLocaleDateString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Last active</dt>
                  <dd>{relative(device.lastActiveAt)}</dd>
                </div>
              </dl>

              {device.lastError && (
                <p
                  className="rounded bg-danger/10 px-2 py-1 text-xs text-danger"
                  role="alert"
                >
                  {device.lastError}
                </p>
              )}

              <div className="mt-1 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => void run(device.id, 'device:reconnect')}
                  disabled={busyId === device.id}
                  data-testid="reconnect-device"
                >
                  Reconnect
                </Button>
                {confirmLogout === device.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void run(device.id, 'device:logout')}
                      disabled={busyId === device.id}
                      data-testid="confirm-logout"
                    >
                      Confirm logout
                    </Button>
                    <Button size="sm" onClick={() => setConfirmLogout(undefined)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirmLogout(device.id)}
                    disabled={busyId === device.id}
                    data-testid="logout-device"
                  >
                    Logout
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mounted only while open so each attempt starts fresh. */}
      {adding && (
        <AddDeviceDialog
          onClose={() => setAdding(false)}
          onConnected={() => {
            toast('success', 'Device connected')
            devices.refetch()
          }}
        />
      )}
    </>
  )
}

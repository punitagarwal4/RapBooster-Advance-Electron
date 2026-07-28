/**
 * Device channels.
 *
 * wa-service owns the sockets; this module owns the database rows. It is the
 * only place device state is written, which is what keeps main the single
 * writer (CLAUDE.md §2.4).
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../shared/errors'
import { MAX_DEVICES } from '../../../shared/types'
import type { DeviceStatus } from '../../../shared/types'
import { getPrisma } from '../db/client'
import { sessionsDir } from '../db/paths'
import { waBridge } from '../wa-bridge'
import { registerHandler } from './router'

function authDirFor(deviceId: string): string {
  return join(sessionsDir(), deviceId)
}

function serialize(row: {
  id: string
  name: string
  phone: string | null
  status: string
  lastActiveAt: Date | null
  lastError: string | null
  dailySentCount: number
  createdAt: Date
}) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    status: row.status as DeviceStatus,
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    lastError: row.lastError,
    dailySentCount: row.dailySentCount,
    createdAt: row.createdAt.toISOString(),
  }
}

async function requireDevice(id: string) {
  const device = await getPrisma().device.findUnique({ where: { id } })
  if (!device)
    throw new AppError('NOT_FOUND', { userMessage: 'That device no longer exists.' })
  return device
}

export function registerDeviceHandlers(): void {
  registerHandler('device:list', async () => {
    const rows = await getPrisma().device.findMany({ orderBy: { createdAt: 'asc' } })
    return rows.map(serialize)
  })

  registerHandler('device:create', async ({ name }) => {
    const count = await getPrisma().device.count()
    if (count >= MAX_DEVICES) {
      throw new AppError('DEVICE_LIMIT_REACHED', {
        userMessage: `You can connect at most ${MAX_DEVICES} devices.`,
      })
    }

    const device = await getPrisma().device.create({
      data: { name, authFolder: '', status: 'disconnected' },
    })
    // The folder name is the id, which only exists after the insert.
    const updated = await getPrisma().device.update({
      where: { id: device.id },
      data: { authFolder: device.id },
    })
    return serialize(updated)
  })

  registerHandler('device:rename', async ({ id, name }) => {
    await requireDevice(id)
    return serialize(await getPrisma().device.update({ where: { id }, data: { name } }))
  })

  registerHandler('device:connect', async ({ id }) => {
    const device = await requireDevice(id)
    await getPrisma().device.update({
      where: { id },
      data: { status: 'connecting', lastError: null },
    })
    await waBridge.request('device:connect', {
      deviceId: device.id,
      authDir: authDirFor(device.id),
    })
    return { ok: true as const }
  })

  registerHandler('device:requestPairingCode', async ({ id, phone }) => {
    await requireDevice(id)
    const { code } = await waBridge.request('device:pairingCode', { deviceId: id, phone })
    return { code }
  })

  registerHandler('device:reconnect', async ({ id }) => {
    const device = await requireDevice(id)
    // Reconnecting is the user overriding the circuit breaker, so the failure
    // counter resets — otherwise a device that gave up could never come back.
    await getPrisma().device.update({
      where: { id },
      data: { status: 'connecting', lastError: null, consecutiveFailures: 0 },
    })
    await waBridge.request('device:disconnect', { deviceId: id }).catch(() => {
      // Not being connected is the normal case here.
    })
    await waBridge.request('device:connect', {
      deviceId: device.id,
      authDir: authDirFor(device.id),
    })
    return { ok: true as const }
  })

  registerHandler('device:logout', async ({ id }) => {
    await requireDevice(id)
    await waBridge.request('device:logout', { deviceId: id }).catch((err: unknown) => {
      // The socket may already be gone; the row and credentials still must go.
      console.warn(`device:logout — service call failed for ${id}`, err)
    })
    await rm(authDirFor(id), { recursive: true, force: true })
    await getPrisma().device.update({
      where: { id },
      data: { status: 'logged_out', phone: null, jid: null },
    })
    return { ok: true as const }
  })

  registerHandler('device:delete', async ({ id }) => {
    await requireDevice(id)
    await waBridge.request('device:logout', { deviceId: id }).catch(() => {
      // Deleting a never-connected device is legitimate.
    })
    await rm(authDirFor(id), { recursive: true, force: true })
    await getPrisma().device.delete({ where: { id } })
    return { ok: true as const }
  })
}

/**
 * Re-open sockets for devices that were connected before a restart.
 *
 * Called by the supervisor's recovery hook. State comes from the database, not
 * from anything the dead process held (CLAUDE.md §5.5).
 */
export async function recoverDeviceSessions(): Promise<void> {
  const devices = await getPrisma().device.findMany({
    where: {
      status: { in: ['connected', 'connecting', 'qr_pending', 'pairing_pending'] },
    },
  })
  for (const device of devices) {
    try {
      await waBridge.request('device:connect', {
        deviceId: device.id,
        authDir: authDirFor(device.id),
      })
    } catch (err) {
      console.error(`recovery: could not reconnect device ${device.id}`, err)
    }
  }
  if (devices.length > 0) {
    console.log(`recovery: re-opened ${devices.length} device session(s)`)
  }
}

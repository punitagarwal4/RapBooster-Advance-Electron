import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  cleanupUserDataDir,
  launchLicensed,
  newUserDataDir,
} from './fixtures/licensed-app'

function deviceRows(dir: string) {
  const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
  try {
    return db
      .prepare('SELECT id, name, status, phone FROM Device ORDER BY createdAt')
      .all() as Array<{ id: string; name: string; status: string; phone: string | null }>
  } finally {
    db.close()
  }
}

test('E2.10 — wa-service reports its state to the renderer', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    // Read the current state rather than waiting for a transition: the service
    // reaches 'up' during boot, so a listener attached afterwards would never
    // see a change.
    await expect
      .poll(
        async () => {
          const r = await win.evaluate(() => window.api.invoke('system:waServiceState'))
          return r.ok ? r.data.state : 'error'
        },
        { timeout: 20_000 },
      )
      .toBe('up')

    const result = await win.evaluate(() => window.api.invoke('system:waServiceState'))
    expect(result.ok).toBe(true)
    // A healthy boot must not have needed any restarts.
    if (result.ok) expect(result.data.restartCount).toBe(0)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.1 — a device connects via QR and reaches connected', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const created = await win.evaluate(() =>
      window.api.invoke('device:create', { name: 'Main Device' }),
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const connect = await win.evaluate(
      (id) => window.api.invoke('device:connect', { id }),
      created.data.id,
    )
    expect(connect.ok).toBe(true)

    // The mock reports connected shortly after connect(); poll the database
    // rather than sleeping.
    await expect
      .poll(() => deviceRows(dir).find((d) => d.id === created.data.id)?.status, {
        timeout: 15_000,
      })
      .toBe('connected')

    const row = deviceRows(dir).find((d) => d.id === created.data.id)
    expect(row?.phone).toMatch(/^\+/)

    // Credentials directory is created under userData/sessions/<deviceId>.
    expect(existsSync(join(dir, 'sessions', created.data.id))).toBe(true)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.2 — pairing code path returns an 8-digit code and connects', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const created = await win.evaluate(() =>
      window.api.invoke('device:create', { name: 'Pairing Device' }),
    )
    if (!created.ok) throw new Error('device:create failed')

    await win.evaluate(
      (id) => window.api.invoke('device:connect', { id }),
      created.data.id,
    )

    const code = await win.evaluate(
      (id) =>
        window.api.invoke('device:requestPairingCode', { id, phone: '+919876543210' }),
      created.data.id,
    )
    expect(code.ok).toBe(true)
    if (code.ok) expect(code.data.code).toMatch(/^\d{8}$/)

    await expect
      .poll(() => deviceRows(dir).find((d) => d.id === created.data.id)?.status, {
        timeout: 15_000,
      })
      .toBe('connected')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.9 — the device limit is enforced', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    // 20 is the documented ceiling (shared/types MAX_DEVICES).
    const results = await win.evaluate(async () => {
      const out: boolean[] = []
      for (let i = 0; i < 21; i += 1) {
        const r = await window.api.invoke('device:create', { name: `Device ${i}` })
        out.push(r.ok)
      }
      return out
    })

    expect(results.slice(0, 20).every(Boolean)).toBe(true)
    expect(results[20]).toBe(false)

    const last = await win.evaluate(() =>
      window.api.invoke('device:create', { name: 'One too many' }),
    )
    expect(last.ok).toBe(false)
    if (!last.ok) expect(last.error.code).toBe('DEVICE_LIMIT_REACHED')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.3 — device rows and credentials survive a restart', async () => {
  const dir = newUserDataDir()
  let session = await launchLicensed(dir)
  let deviceId = ''
  try {
    const created = await session.win.evaluate(() =>
      window.api.invoke('device:create', { name: 'Persistent Device' }),
    )
    if (!created.ok) throw new Error('device:create failed')
    deviceId = created.data.id

    await session.win.evaluate(
      (id) => window.api.invoke('device:connect', { id }),
      deviceId,
    )
    await expect
      .poll(() => deviceRows(dir).find((d) => d.id === deviceId)?.status, {
        timeout: 15_000,
      })
      .toBe('connected')
  } finally {
    await session.app.close()
  }

  session = await launchLicensed(dir)
  try {
    const rows = deviceRows(dir)
    expect(rows.find((d) => d.id === deviceId)?.name).toBe('Persistent Device')
    expect(existsSync(join(dir, 'sessions', deviceId))).toBe(true)

    // The recovery hook re-opens sessions that were connected before shutdown.
    await expect
      .poll(() => deviceRows(dir).find((d) => d.id === deviceId)?.status, {
        timeout: 20_000,
      })
      .toBe('connected')
  } finally {
    await session.app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.6 — logout clears credentials and marks the device logged out', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const created = await win.evaluate(() =>
      window.api.invoke('device:create', { name: 'Logout Device' }),
    )
    if (!created.ok) throw new Error('device:create failed')
    const id = created.data.id

    await win.evaluate((d) => window.api.invoke('device:connect', { id: d }), id)
    await expect
      .poll(() => deviceRows(dir).find((d) => d.id === id)?.status, { timeout: 15_000 })
      .toBe('connected')

    const out = await win.evaluate(
      (d) => window.api.invoke('device:logout', { id: d }),
      id,
    )
    expect(out.ok).toBe(true)

    await expect
      .poll(() => deviceRows(dir).find((d) => d.id === id)?.status, { timeout: 10_000 })
      .toBe('logged_out')
    // Credentials must not survive a logout — they are useless and reusing
    // them would be a security problem.
    expect(existsSync(join(dir, 'sessions', id))).toBe(false)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.3b — the Devices screen links a device through the QR flow', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await win.getByTestId('nav-devices').click()
    await expect(win.getByTestId('page-title')).toHaveText('WhatsApp Devices')

    // Empty state offers the primary action.
    await win.getByTestId('add-device').click()
    await expect(win.getByTestId('add-device-dialog')).toBeVisible()

    // A device name is required before anything is created.
    await win.getByTestId('generate-qr').click()
    await expect(win.getByTestId('add-device-error')).toContainText('required')

    const nameInput = win.getByTestId('device-name')
    await nameInput.fill('Office PC')
    await expect(nameInput).toHaveValue('Office PC')
    await win.getByTestId('generate-qr').click()

    // The dialog closes itself once the device reports connected.
    await expect(win.getByTestId('add-device-dialog')).toHaveCount(0, { timeout: 20_000 })
    await expect(win.getByTestId('device-card')).toHaveCount(1)
    await expect(win.getByTestId('device-grid')).toContainText('Office PC')
    await expect(win.getByTestId('device-grid')).toContainText('Connected')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.6b — logout from the Devices screen requires confirmation', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const created = await win.evaluate(async () => {
      const r = await window.api.invoke('device:create', { name: 'Confirm Me' })
      if (r.ok) await window.api.invoke('device:connect', { id: r.data.id })
      return r.ok ? r.data.id : ''
    })
    expect(created).not.toBe('')

    await win.getByTestId('nav-devices').click()
    await expect(win.getByTestId('device-card')).toHaveCount(1)

    await win.getByTestId('logout-device').click()
    // Destructive actions must not fire on a single click.
    await expect(win.getByTestId('confirm-logout')).toBeVisible()
    await win.getByTestId('confirm-logout').click()

    await expect
      .poll(() => deviceRows(dir).find((d) => d.id === created)?.status, {
        timeout: 15_000,
      })
      .toBe('logged_out')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.8 — twenty devices connect concurrently', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const ids = await win.evaluate(async () => {
      const out: string[] = []
      for (let i = 0; i < 20; i += 1) {
        const r = await window.api.invoke('device:create', { name: `Bulk ${i}` })
        if (r.ok) out.push(r.data.id)
      }
      await Promise.all(out.map((id) => window.api.invoke('device:connect', { id })))
      return out
    })
    expect(ids).toHaveLength(20)

    await expect
      .poll(() => deviceRows(dir).filter((d) => d.status === 'connected').length, {
        timeout: 30_000,
      })
      .toBe(20)

    // The UI must still respond while twenty sockets are live.
    await win.getByTestId('nav-devices').click()
    await expect(win.getByTestId('page-title')).toHaveText('WhatsApp Devices')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

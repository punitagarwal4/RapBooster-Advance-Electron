import { expect, test } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { cleanupUserDataDir, launchWith, newUserDataDir } from './fixtures/licensed-app'

/**
 * Licensing E2E (SPRINTS.md §9.3, E1.1–E1.9 and E1.11).
 *
 * These own their app lifecycle rather than using the shared fixture, because
 * several cases turn on what survives a restart — a fixture that discards
 * userData between tests cannot express that.
 */

test('E1.1 — a fresh install shows activation, not the application', async () => {
  const dir = newUserDataDir()
  const app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('license-key')).toBeVisible()
    // The sidebar must not exist while unlicensed.
    await expect(win.getByTestId('nav-dashboard')).toHaveCount(0)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.4 — an empty key reports that it is required', async () => {
  const dir = newUserDataDir()
  const app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await win.getByTestId('license-activate').click()
    await expect(win.getByTestId('license-error')).toHaveText('License key is required.')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.3 — an invalid key is rejected and nothing is stored', async () => {
  const dir = newUserDataDir()
  const app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await win.getByTestId('license-key').fill('NOT-A-REAL-KEY')
    await win.getByTestId('license-activate').click()

    await expect(win.getByTestId('license-error')).toContainText('Invalid license key')
    await expect(win.getByTestId('nav-dashboard')).toHaveCount(0)

    const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM License').get() as { n: number }
      expect(Number(row.n)).toBe(0)
    } finally {
      db.close()
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.2 + E1.7 — a valid key activates, stores remarks, and persists across restart', async () => {
  const dir = newUserDataDir()
  let app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await win.getByTestId('license-key').fill('VALID-2024-001')
    await win.getByTestId('license-remarks').fill('Primary workstation')
    await win.getByTestId('license-activate').click()

    // The window swaps to the application once activation succeeds.
    await expect(win.getByTestId('nav-dashboard')).toBeVisible({ timeout: 15_000 })

    const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
    try {
      const row = db
        .prepare('SELECT status, remarks, keyMasked, keyEncrypted FROM License')
        .get() as { status: string; remarks: string; keyMasked: string; keyEncrypted: string }
      expect(row.status).toBe('valid')
      expect(row.remarks).toBe('Primary workstation')
      // The raw key must never be readable in the database.
      expect(row.keyEncrypted).not.toContain('VALID-2024-001')
      expect(row.keyMasked).not.toBe('VALID-2024-001')
    } finally {
      db.close()
    }
  } finally {
    await app.close()
  }

  // Relaunch: no re-prompt.
  app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('nav-dashboard')).toBeVisible({ timeout: 15_000 })
    await expect(win.getByTestId('license-key')).toHaveCount(0)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.5 — a conflicting key opens the dialog and transfers successfully', async () => {
  const dir = newUserDataDir()
  const app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await win.getByTestId('license-key').fill('CONFLICT-2024-001')
    await win.getByTestId('license-activate').click()

    await expect(win.getByTestId('license-conflict-dialog')).toBeVisible()
    // The prototype shows the other machine's name and a relative last-used time.
    await expect(win.getByTestId('conflict-device')).toContainText('Another Computer')
    await expect(win.getByTestId('conflict-device')).toContainText('days ago')

    await win.getByTestId('conflict-transfer').click()
    await expect(win.getByTestId('nav-dashboard')).toBeVisible({ timeout: 15_000 })
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.6 — cancelling the conflict dialog stores nothing', async () => {
  const dir = newUserDataDir()
  const app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await win.getByTestId('license-key').fill('CONFLICT-2024-001')
    await win.getByTestId('license-activate').click()
    await expect(win.getByTestId('license-conflict-dialog')).toBeVisible()

    await win.getByTestId('conflict-cancel').click()
    await expect(win.getByTestId('license-conflict-dialog')).toHaveCount(0)
    await expect(win.getByTestId('license-key')).toBeVisible()

    const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM License').get() as { n: number }
      expect(Number(row.n)).toBe(0)
    } finally {
      db.close()
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.3b — expired and revoked keys report their own reason', async () => {
  const dir = newUserDataDir()
  const app = await launchWith(dir)
  try {
    const win = await app.firstWindow()

    await win.getByTestId('license-key').fill('EXPIRED-2024-001')
    await win.getByTestId('license-activate').click()
    await expect(win.getByTestId('license-error')).toContainText('expired')

    await win.getByTestId('license-key').fill('REVOKED-2024-001')
    await win.getByTestId('license-activate').click()
    await expect(win.getByTestId('license-error')).toContainText('revoked')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.11 — a tampered license record re-gates the application', async () => {
  const dir = newUserDataDir()
  let app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await win.getByTestId('license-key').fill('VALID-2024-002')
    await win.getByTestId('license-activate').click()
    await expect(win.getByTestId('nav-dashboard')).toBeVisible({ timeout: 15_000 })
  } finally {
    await app.close()
  }

  // Forge a valid-looking record without a matching signature — what someone
  // editing the file with a database browser would produce.
  const db = new DatabaseSync(join(dir, 'rapbooster.db'))
  try {
    db.prepare("UPDATE License SET status = 'valid', signature = 'forged'").run()
  } finally {
    db.close()
  }

  app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('license-key')).toBeVisible()
    await expect(win.getByTestId('nav-dashboard')).toHaveCount(0)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.9 — deactivating from the app returns to the activation screen', async () => {
  const dir = newUserDataDir()
  const app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await win.getByTestId('license-key').fill('VALID-2024-001')
    await win.getByTestId('license-activate').click()
    await expect(win.getByTestId('nav-dashboard')).toBeVisible({ timeout: 15_000 })

    // The Settings panel lands in T1.9; the channel behind it is what matters here.
    const result = await win.evaluate(() => window.api.invoke('license:deactivate'))
    expect(result.ok).toBe(true)

    await expect(win.getByTestId('license-key')).toBeVisible({ timeout: 15_000 })
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.14f — data channels are refused while unlicensed', async () => {
  const dir = newUserDataDir()
  const app = await launchWith(dir)
  try {
    const win = await app.firstWindow()
    await expect(win.getByTestId('license-key')).toBeVisible()

    // Defence in depth: even reaching the channel directly must yield nothing.
    const result = await win.evaluate(() => window.api.invoke('system:dashboard'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LICENSE_REQUIRED')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

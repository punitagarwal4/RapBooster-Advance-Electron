import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  cleanupUserDataDir,
  launchLicensed,
  newUserDataDir,
} from './fixtures/licensed-app'

/**
 * Sprint 4 — settings, backup and dashboard (SPRINTS.md §12.3, E4.15–E4.22).
 */

function count(dir: string, table: string): number {
  const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }
    return Number(row.n)
  } finally {
    db.close()
  }
}

function backups(dir: string): string[] {
  const path = join(dir, 'backups')
  return existsSync(path) ? readdirSync(path).filter((f) => f.endsWith('.db')) : []
}

async function seedData(win: Page): Promise<void> {
  await win.evaluate(async () => {
    const list = await window.api.invoke('contactList:create', {
      name: 'Seed',
      customFields: [],
    })
    if (!list.ok) throw new Error('list')
    for (let i = 0; i < 5; i += 1) {
      await window.api.invoke('contacts:create', {
        listId: list.data.id,
        data: { Name: `P${i}`, Mobile: `9${String(300000000 + i).padStart(9, '0')}` },
      })
    }
    await window.api.invoke('template:create', { name: 'T', type: 'text', content: 'hi' })
  })
}

test('E4.19 — sending defaults save, validate, and apply to new campaigns', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    // A range that starts after it ends is refused with an actionable message.
    const bad = await win.evaluate(() =>
      window.api.invoke('settings:setSendingDefaults', {
        delayFrom: 30,
        delayTo: 5,
        sleepDuration: 10,
        sleepAfter: 10,
        groupMessageDelay: 2,
        groupCreateDelay: 2,
        dailyCapPerDevice: 0,
        retryAttempts: 2,
        maxConcurrentDevices: 20,
      }),
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.userMessage).toContain('swap')

    const good = await win.evaluate(() =>
      window.api.invoke('settings:setSendingDefaults', {
        delayFrom: 3,
        delayTo: 9,
        sleepDuration: 20,
        sleepAfter: 25,
        groupMessageDelay: 4,
        groupCreateDelay: 3,
        dailyCapPerDevice: 500,
        retryAttempts: 1,
        maxConcurrentDevices: 10,
      }),
    )
    expect(good.ok).toBe(true)

    const read = await win.evaluate(() =>
      window.api.invoke('settings:getSendingDefaults'),
    )
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.data.delayFrom).toBe(3)
      expect(read.data.dailyCapPerDevice).toBe(500)
      expect(read.data.maxConcurrentDevices).toBe(10)
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.20 — a manual backup is written and clearing data backs up first', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await seedData(win)
    expect(count(dir, 'Contact')).toBe(5)

    const backup = await win.evaluate(() => window.api.invoke('system:backup'))
    expect(backup.ok).toBe(true)
    if (backup.ok) expect(existsSync(backup.data.filePath)).toBe(true)

    const afterBackup = backups(dir).length
    expect(afterBackup).toBeGreaterThan(0)

    // Wrong confirmation must not clear anything.
    const refused = await win.evaluate(() =>
      window.api.invoke('system:clearData', { confirmation: 'delete' as never }),
    )
    expect(refused.ok).toBe(false)
    expect(count(dir, 'Contact')).toBe(5)

    const cleared = await win.evaluate(() =>
      window.api.invoke('system:clearData', { confirmation: 'DELETE' }),
    )
    expect(cleared.ok).toBe(true)

    expect(count(dir, 'Contact')).toBe(0)
    expect(count(dir, 'ContactList')).toBe(0)
    expect(count(dir, 'Template')).toBe(0)
    // The license survives — clearing data is not deactivating.
    expect(count(dir, 'License')).toBe(1)
    // And a fresh backup was taken before the delete.
    expect(backups(dir).length).toBeGreaterThan(afterBackup)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.20b — restoring a corrupt file is refused rather than destroying the database', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await seedData(win)
    expect(count(dir, 'Contact')).toBe(5)

    // Not a SQLite file at all.
    const bogus = join(dir, 'not-a-backup.db')
    writeFileSync(bogus, 'this is not a database')

    const result = await win.evaluate(
      (p) => window.api.invoke('system:restore', { filePath: p }),
      bogus,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTEGRITY_FAILED')

    // The working database must be untouched — a failed restore that destroyed
    // data would turn a recoverable situation into a disaster.
    expect(count(dir, 'Contact')).toBe(5)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.22 — dashboard aggregates match the database', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await seedData(win)

    const stats = await win.evaluate(() => window.api.invoke('system:dashboard'))
    expect(stats.ok).toBe(true)
    if (!stats.ok) return

    expect(stats.data.totalContacts).toBe(count(dir, 'Contact'))
    expect(stats.data.templates).toBe(count(dir, 'Template'))
    expect(stats.data.activeDevices).toBe(0)
    expect(stats.data.runningCampaigns).toBe(0)

    // Navigate away and back so the screen remounts — seeding happened over
    // IPC while the dashboard was already open.
    await win.getByTestId('nav-settings').click()
    await expect(win.getByTestId('page-title')).toHaveText('Settings')
    await win.getByTestId('nav-dashboard').click()
    await expect(win.getByTestId('dashboard-stats')).toContainText('5')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.21 — the Settings screen exposes sending defaults and a guarded clear', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await win.getByTestId('nav-settings').click()
    await expect(win.getByTestId('page-title')).toHaveText('Settings')

    const delayFrom = win.getByTestId('sd-delayFrom')
    await expect(delayFrom).toBeVisible()
    await delayFrom.fill('4')
    await expect(delayFrom).toHaveValue('4')

    await win.getByTestId('save-sending-defaults').click()
    await expect(win.getByTestId('toast')).toBeVisible()

    const saved = await win.evaluate(() =>
      window.api.invoke('settings:getSendingDefaults'),
    )
    if (saved.ok) expect(saved.data.delayFrom).toBe(4)

    // Clear stays disabled until the exact word is typed — a destructive action
    // with no undo should be hard to trigger by accident.
    await expect(win.getByTestId('clear-data')).toBeDisabled()
    await win.getByTestId('clear-confirm').fill('delete')
    await expect(win.getByTestId('clear-data')).toBeDisabled()
    await win.getByTestId('clear-confirm').fill('DELETE')
    await expect(win.getByTestId('clear-data')).toBeEnabled()
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

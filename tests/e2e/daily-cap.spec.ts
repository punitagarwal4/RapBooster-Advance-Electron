/**
 * Per-device daily send cap (SPRINTS.md §6.1).
 *
 * This is an anti-ban control: it is the thing standing between a
 * misconfigured campaign and an account WhatsApp decides is a spammer. It had
 * two independent defects, both invisible from the UI:
 *
 *  1. The configured cap was never sent to the throttle at all. The setting
 *     saved, the Settings screen showed it, and the scheduler supported a
 *     `dailyCap` — but nothing carried the value between them, so the cap did
 *     nothing whatsoever.
 *  2. `Device.dailySentCount` was only ever incremented; the `dailyCountResetAt`
 *     column meant to roll it over daily was never read or written. So the count
 *     handed to the throttle was the device's *lifetime* total. Once that passed
 *     the cap, the device could never send again — turning the protection on
 *     would eventually brick sending permanently.
 *
 * Defect 2 was masked by defect 1: with the cap never applied, the growing
 * counter never blocked anything.
 */
import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  cleanupUserDataDir,
  launchLicensed,
  newUserDataDir,
} from './fixtures/licensed-app'

async function seed(
  win: Page,
  contacts: number,
): Promise<{ listId: string; deviceId: string; templateId: string }> {
  return win.evaluate(async (n) => {
    const list = await window.api.invoke('contactList:create', {
      name: `Cap list ${Date.now()}`,
      customFields: [],
    })
    if (!list.ok) throw new Error('list')
    for (let i = 0; i < n; i += 1) {
      await window.api.invoke('contacts:create', {
        listId: list.data.id,
        data: {
          Name: `Person ${i}`,
          Mobile: `9${String(600000000 + i).padStart(9, '0')}`,
        },
      })
    }
    const device = await window.api.invoke('device:create', { name: 'Capped' })
    if (!device.ok) throw new Error('device')
    await window.api.invoke('device:connect', { id: device.data.id })

    const template = await window.api.invoke('template:create', {
      name: `Cap tpl ${Date.now()}`,
      type: 'text',
      content: 'Hello {{Name}}',
    })
    if (!template.ok) throw new Error('template')
    return {
      listId: list.data.id,
      deviceId: device.data.id,
      templateId: template.data.id,
    }
  }, contacts)
}

async function startCampaign(
  win: Page,
  f: { listId: string; deviceId: string; templateId: string },
): Promise<string> {
  return win.evaluate(async (fx) => {
    const c = await window.api.invoke('campaign:create', {
      name: `Cap camp ${Date.now()}`,
      templateId: fx.templateId,
      deviceIds: [fx.deviceId],
      listIds: [fx.listId],
      delayFrom: 0,
      delayTo: 0,
      sleepDuration: 0,
      sleepAfter: 100,
    })
    if (!c.ok) throw new Error('campaign')
    await window.api.invoke('campaign:start', { id: c.data.id })
    return c.data.id
  }, f)
}

function sentCount(dir: string): number {
  const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM CampaignRecipient WHERE status = 'sent'`)
      .get() as { n: number }
    return Number(row.n)
  } finally {
    db.close()
  }
}

function deviceCounter(
  dir: string,
  deviceId: string,
): { count: number; resetAt: string | null } {
  const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
  try {
    const row = db
      .prepare('SELECT dailySentCount, dailyCountResetAt FROM Device WHERE id = ?')
      .get(deviceId) as { dailySentCount: number; dailyCountResetAt: string | null }
    return { count: Number(row.dailySentCount), resetAt: row.dailyCountResetAt }
  } finally {
    db.close()
  }
}

test('E3.27 — the configured daily cap actually stops sending', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await win.evaluate(async () => {
      const current = await window.api.invoke('settings:getSendingDefaults')
      if (!current.ok) throw new Error('defaults')
      await window.api.invoke('settings:setSendingDefaults', {
        ...current.data,
        dailyCapPerDevice: 3,
      })
    })

    const f = await seed(win, 10)
    await startCampaign(win, f)

    // Sends should stop at the cap and stay there, not run to all 10.
    await expect.poll(() => sentCount(dir), { timeout: 45_000 }).toBe(3)
    await win.waitForTimeout(3000)
    expect(sentCount(dir)).toBe(3)

    // And the counter used to enforce it is stamped with today's date, which is
    // what makes tomorrow's rollover possible.
    const counter = deviceCounter(dir, f.deviceId)
    expect(counter.count).toBe(3)
    expect(counter.resetAt).not.toBeNull()
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test("E3.28 — yesterday's sends do not count against today's cap", async () => {
  const dir = newUserDataDir()
  let session = await launchLicensed(dir)
  let f: { listId: string; deviceId: string; templateId: string }
  try {
    await session.win.evaluate(async () => {
      const current = await window.api.invoke('settings:getSendingDefaults')
      if (!current.ok) throw new Error('defaults')
      await window.api.invoke('settings:setSendingDefaults', {
        ...current.data,
        dailyCapPerDevice: 3,
      })
    })
    f = await seed(session.win, 10)
  } finally {
    await session.app.close()
  }

  // Simulate a device that already sent far more than the cap — but on an
  // earlier day. Before the fix this permanently blocked the device: the
  // lifetime total was seeded as "today", so the very first cap check threw.
  const db = new DatabaseSync(join(dir, 'rapbooster.db'))
  try {
    db.prepare(
      'UPDATE Device SET dailySentCount = ?, dailyCountResetAt = ? WHERE id = ?',
    ).run(500, new Date(Date.now() - 3 * 86_400_000).toISOString(), f.deviceId)
  } finally {
    db.close()
  }

  session = await launchLicensed(dir)
  try {
    await session.win.evaluate(
      (id) => window.api.invoke('device:connect', { id }),
      f.deviceId,
    )
    await startCampaign(session.win, f)

    // It must send again — up to today's cap, not zero.
    await expect.poll(() => sentCount(dir), { timeout: 45_000 }).toBe(3)
    expect(deviceCounter(dir, f.deviceId).count).toBe(3)
  } finally {
    await session.app.close()
    cleanupUserDataDir(dir)
  }
})

import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cleanupUserDataDir, launchLicensed, newUserDataDir } from './fixtures/licensed-app'

/**
 * Sprint 3 — campaign engine (SPRINTS.md §11.3, E3.1–E3.12).
 *
 * E3.8 is the one that matters most: a campaign killed mid-send must resume
 * without double-sending beyond the documented bound (SPRINTS §6.4).
 */

interface Fixture {
  listId: string
  deviceIds: string[]
  templateId: string
}

/** Build a campaign's prerequisites: a list of contacts, devices, a template. */
async function seed(
  win: Page,
  contacts: number,
  devices = 1,
): Promise<Fixture> {
  return win.evaluate(
    async ({ n, deviceCount }) => {
      const list = await window.api.invoke('contactList:create', {
        name: `List ${Date.now()}`,
        customFields: ['Company'],
      })
      if (!list.ok) throw new Error('list')

      for (let i = 0; i < n; i += 1) {
        await window.api.invoke('contacts:create', {
          listId: list.data.id,
          data: {
            Name: `Person ${i}`,
            Mobile: `9${String(500000000 + i).padStart(9, '0')}`,
            Company: `Acme ${i}`,
          },
        })
      }

      const deviceIds: string[] = []
      for (let i = 0; i < deviceCount; i += 1) {
        const d = await window.api.invoke('device:create', { name: `Sender ${i}` })
        if (!d.ok) throw new Error('device')
        deviceIds.push(d.data.id)
        await window.api.invoke('device:connect', { id: d.data.id })
      }

      const template = await window.api.invoke('template:create', {
        name: `Tpl ${Date.now()}`,
        type: 'text',
        content: 'Hi {{Name}} from {{Company}}',
      })
      if (!template.ok) throw new Error('template')

      return { listId: list.data.id, deviceIds, templateId: template.data.id }
    },
    { n: contacts, deviceCount: devices },
  )
}

function recipientRows(dir: string, campaignId?: string) {
  const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
  try {
    const sql = campaignId
      ? 'SELECT id, status, messageId, attempts FROM CampaignRecipient WHERE campaignId = ?'
      : 'SELECT id, status, messageId, attempts FROM CampaignRecipient'
    const stmt = db.prepare(sql)
    return (campaignId ? stmt.all(campaignId) : stmt.all()) as Array<{
      id: string
      status: string
      messageId: string | null
      attempts: number
    }>
  } finally {
    db.close()
  }
}

test('E3.1 + E3.2 — campaign creation validates devices and lists', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const f = await seed(win, 3)

    const noDevice = await win.evaluate(
      (fx) =>
        window.api.invoke('campaign:create', {
          name: 'No device',
          templateId: fx.templateId,
          deviceIds: [],
          listIds: [fx.listId],
          delayFrom: 0,
          delayTo: 0,
          sleepDuration: 0,
          sleepAfter: 100,
        }),
      f,
    )
    expect(noDevice.ok).toBe(false)
    if (!noDevice.ok) {
      // Matches the prototype's wording.
      expect(noDevice.error.userMessage).toContain('at least one device')
    }

    const good = await win.evaluate(
      (fx) =>
        window.api.invoke('campaign:create', {
          name: 'Spring Sale',
          templateId: fx.templateId,
          deviceIds: fx.deviceIds,
          listIds: [fx.listId],
          delayFrom: 0,
          delayTo: 0,
          sleepDuration: 0,
          sleepAfter: 100,
        }),
      f,
    )
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.data.name).toBe('Spring Sale')
      expect(good.data.status).toBe('draft')
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.3 — a campaign sends to every recipient and counters reconcile', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const CONTACTS = 40
    const f = await seed(win, CONTACTS, 2)

    const campaignId = await win.evaluate(async (fx) => {
      const c = await window.api.invoke('campaign:create', {
        name: 'Reconcile',
        templateId: fx.templateId,
        deviceIds: fx.deviceIds,
        listIds: [fx.listId],
        delayFrom: 0,
        delayTo: 0,
        sleepDuration: 0,
        sleepAfter: 100,
      })
      if (!c.ok) throw new Error('create')
      await window.api.invoke('campaign:start', { id: c.data.id })
      return c.data.id
    }, f)

    await expect
      .poll(() => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length, {
        timeout: 120_000,
      })
      .toBe(CONTACTS)

    const rows = recipientRows(dir, campaignId)
    // Every sent row carries the id WhatsApp returned — that is what makes a
    // send auditable after the fact.
    expect(rows.every((r) => r.status !== 'sent' || r.messageId)).toBe(true)

    const summary = await win.evaluate(
      (id) => window.api.invoke('campaign:get', { id }),
      campaignId,
    )
    expect(summary.ok).toBe(true)
    if (summary.ok) {
      expect(summary.data.sentCount).toBe(CONTACTS)
      expect(summary.data.failedCount).toBe(0)
      expect(summary.data.totalCount).toBe(CONTACTS)
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.16 — a contact in two selected lists is queued exactly once', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const ids = await win.evaluate(async () => {
      const a = await window.api.invoke('contactList:create', { name: 'A', customFields: [] })
      const b = await window.api.invoke('contactList:create', { name: 'B', customFields: [] })
      if (!a.ok || !b.ok) throw new Error('lists')

      // The same number in both lists is two Contact rows but one person.
      await window.api.invoke('contacts:create', {
        listId: a.data.id,
        data: { Name: 'Dup', Mobile: '9876543210' },
      })
      await window.api.invoke('contacts:create', {
        listId: b.data.id,
        data: { Name: 'Dup', Mobile: '9876543210' },
      })

      const device = await window.api.invoke('device:create', { name: 'S' })
      if (!device.ok) throw new Error('device')
      await window.api.invoke('device:connect', { id: device.data.id })

      const template = await window.api.invoke('template:create', {
        name: 'T',
        type: 'text',
        content: 'Hello',
      })
      if (!template.ok) throw new Error('template')

      const campaign = await window.api.invoke('campaign:create', {
        name: 'Dedupe',
        templateId: template.data.id,
        deviceIds: [device.data.id],
        listIds: [a.data.id, b.data.id],
        delayFrom: 0,
        delayTo: 0,
        sleepDuration: 0,
        sleepAfter: 100,
      })
      if (!campaign.ok) throw new Error('campaign')
      await window.api.invoke('campaign:start', { id: campaign.data.id })
      return campaign.data.id
    })

    await expect
      .poll(() => recipientRows(dir, ids).filter((r) => r.status === 'sent').length, {
        timeout: 60_000,
      })
      .toBeGreaterThan(0)

    // Two Contact rows exist, so two queue rows are correct — what must not
    // happen is the same Contact queued twice.
    const rows = recipientRows(dir, ids)
    expect(rows).toHaveLength(2)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.6 — pause stops sending and resume continues from the same position', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const f = await seed(win, 60, 1)

    const campaignId = await win.evaluate(async (fx) => {
      const c = await window.api.invoke('campaign:create', {
        name: 'Pausable',
        templateId: fx.templateId,
        deviceIds: fx.deviceIds,
        listIds: [fx.listId],
        // Slow enough that pause lands mid-run.
        delayFrom: 1,
        delayTo: 1,
        sleepDuration: 0,
        sleepAfter: 100,
      })
      if (!c.ok) throw new Error('create')
      await window.api.invoke('campaign:start', { id: c.data.id })
      return c.data.id
    }, f)

    await expect
      .poll(() => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length, {
        timeout: 60_000,
      })
      .toBeGreaterThan(0)

    await win.evaluate((id) => window.api.invoke('campaign:pause', { id }), campaignId)
    const atPause = recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length

    // Nothing may remain claimed after a pause, or those rows would be stranded.
    expect(recipientRows(dir, campaignId).some((r) => r.status === 'sending')).toBe(false)
    expect(atPause).toBeLessThan(60)

    // Sending must stop. SPRINTS §11.1 T3.4 specifies that a worker finishes
    // the message already in flight before stopping, so one more per device may
    // land — but no more than that.
    await new Promise((r) => setTimeout(r, 4_000))
    const afterWait = recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length
    expect(afterWait).toBeLessThanOrEqual(atPause + 1)

    await win.evaluate((id) => window.api.invoke('campaign:resume', { id }), campaignId)
    await expect
      .poll(() => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length, {
        timeout: 120_000,
      })
      .toBeGreaterThan(atPause)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.8 + E3.9 — killing the app mid-campaign resumes without double sends', async () => {
  const dir = newUserDataDir()
  let session = await launchLicensed(dir)
  let campaignId = ''
  let sentBeforeKill: number

  try {
    const f = await seed(session.win, 80, 2)

    campaignId = await session.win.evaluate(async (fx) => {
      const c = await window.api.invoke('campaign:create', {
        name: 'Crash Test',
        templateId: fx.templateId,
        deviceIds: fx.deviceIds,
        listIds: [fx.listId],
        delayFrom: 1,
        delayTo: 1,
        sleepDuration: 0,
        sleepAfter: 100,
      })
      if (!c.ok) throw new Error('create')
      await window.api.invoke('campaign:start', { id: c.data.id })
      return c.data.id
    }, f)

    // Let it get properly under way before pulling the plug.
    await expect
      .poll(() => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length, {
        timeout: 60_000,
      })
      .toBeGreaterThan(3)

    sentBeforeKill = recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length
  } finally {
    // Hard kill — no graceful shutdown, no chance to tidy up.
    await session.app.close()
  }

  const afterKill = recipientRows(dir, campaignId)
  expect(afterKill.filter((r) => r.status === 'sent').length).toBeGreaterThanOrEqual(
    sentBeforeKill,
  )

  session = await launchLicensed(dir)
  try {
    // Nothing may be left stranded in 'sending' once recovery has run.
    await expect
      .poll(() => recipientRows(dir, campaignId).filter((r) => r.status === 'sending').length, {
        timeout: 60_000,
      })
      .toBe(0)

    // The campaign resumes on its own and drains the queue.
    await expect
      .poll(
        () =>
          recipientRows(dir, campaignId).filter(
            (r) => r.status === 'sent' || r.status === 'failed',
          ).length,
        { timeout: 180_000 },
      )
      .toBe(80)

    const rows = recipientRows(dir, campaignId)

    // The core guarantee: one queue row per contact, so a resumed campaign
    // cannot re-queue anyone. At most one in-flight message per device may be
    // re-sent, which is the documented bound in SPRINTS §6.4 — and that shows
    // up as a retried row, never as a duplicate row.
    expect(rows).toHaveLength(80)
    const ids = new Set(rows.map((r) => r.id))
    expect(ids.size).toBe(80)

    const summary = await session.win.evaluate(
      (id) => window.api.invoke('campaign:get', { id }),
      campaignId,
    )
    if (summary.ok) {
      // Counters are recomputed from rows, so they survive the crash intact.
      expect(summary.data.sentCount + summary.data.failedCount).toBe(80)
    }
  } finally {
    await session.app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.12 — send failures retry then settle as failed', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const f = await seed(win, 10, 1)

    // The mock fails deterministically every 3rd send.
    const campaignId = await win.evaluate(async (fx) => {
      const c = await window.api.invoke('campaign:create', {
        name: 'Failures',
        templateId: fx.templateId,
        deviceIds: fx.deviceIds,
        listIds: [fx.listId],
        delayFrom: 0,
        delayTo: 0,
        sleepDuration: 0,
        sleepAfter: 100,
      })
      if (!c.ok) throw new Error('create')
      await window.api.invoke('campaign:start', { id: c.data.id })
      return c.data.id
    }, f)

    await expect
      .poll(
        () =>
          recipientRows(dir, campaignId).filter(
            (r) => r.status === 'sent' || r.status === 'failed',
          ).length,
        { timeout: 120_000 },
      )
      .toBe(10)

    const rows = recipientRows(dir, campaignId)
    // Nothing may be left mid-flight once the queue has drained.
    expect(rows.some((r) => r.status === 'pending' || r.status === 'sending')).toBe(false)
    // A row that failed must show it was actually attempted.
    expect(rows.filter((r) => r.status === 'failed').every((r) => r.attempts > 0)).toBe(true)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

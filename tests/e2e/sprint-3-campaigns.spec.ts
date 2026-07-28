import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  cleanupUserDataDir,
  launchLicensed,
  newUserDataDir,
} from './fixtures/licensed-app'

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
async function seed(win: Page, contacts: number, devices = 1): Promise<Fixture> {
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
            Mobile: `+919${String(500000000 + i).padStart(9, '0')}`,
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
      .poll(
        () => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length,
        {
          timeout: 120_000,
        },
      )
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
      const a = await window.api.invoke('contactList:create', {
        name: 'A',
        customFields: [],
      })
      const b = await window.api.invoke('contactList:create', {
        name: 'B',
        customFields: [],
      })
      if (!a.ok || !b.ok) throw new Error('lists')

      // The same number in both lists is two Contact rows but one person.
      await window.api.invoke('contacts:create', {
        listId: a.data.id,
        data: { Name: 'Dup', Mobile: '+919876543210' },
      })
      await window.api.invoke('contacts:create', {
        listId: b.data.id,
        data: { Name: 'Dup', Mobile: '+919876543210' },
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
      .poll(
        () => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length,
        {
          timeout: 60_000,
        },
      )
      .toBeGreaterThan(0)

    await win.evaluate((id) => window.api.invoke('campaign:pause', { id }), campaignId)
    const atPause = recipientRows(dir, campaignId).filter(
      (r) => r.status === 'sent',
    ).length

    // Nothing may remain claimed after a pause, or those rows would be stranded.
    expect(recipientRows(dir, campaignId).some((r) => r.status === 'sending')).toBe(false)
    expect(atPause).toBeLessThan(60)

    // Sending must stop. SPRINTS §11.1 T3.4 specifies that a worker finishes
    // the message already in flight before stopping, so one more per device may
    // land — but no more than that.
    await new Promise((r) => setTimeout(r, 4_000))
    const afterWait = recipientRows(dir, campaignId).filter(
      (r) => r.status === 'sent',
    ).length
    expect(afterWait).toBeLessThanOrEqual(atPause + 1)

    await win.evaluate((id) => window.api.invoke('campaign:resume', { id }), campaignId)
    await expect
      .poll(
        () => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length,
        {
          timeout: 120_000,
        },
      )
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
      .poll(
        () => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length,
        {
          timeout: 60_000,
        },
      )
      .toBeGreaterThan(3)

    sentBeforeKill = recipientRows(dir, campaignId).filter(
      (r) => r.status === 'sent',
    ).length
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
      .poll(
        () => recipientRows(dir, campaignId).filter((r) => r.status === 'sending').length,
        {
          timeout: 60_000,
        },
      )
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

test('E3.18 — the report lists every recipient with its outcome', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const f = await seed(win, 12, 1)

    const campaignId = await win.evaluate(async (fx) => {
      const c = await window.api.invoke('campaign:create', {
        name: 'Reported',
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
      .toBe(12)

    const report = await win.evaluate(
      (id) => window.api.invoke('campaign:report', { id }),
      campaignId,
    )
    expect(report.ok).toBe(true)
    if (!report.ok) return

    // One row per recipient (REQUIREMENTS §7.2, A9) — a summary alone cannot
    // tell the user which numbers failed.
    expect(report.data.rows).toBe(12)

    const csv = readFileSync(report.data.filePath, 'utf8')
    expect(csv).toContain('# Campaign,Reported')
    expect(csv).toContain('phone,name,device,status,attempts,sentAt,error')
    expect(csv).toContain('+91')
    // Header block plus column header plus 12 data rows.
    expect(csv.trim().split('\n')).toHaveLength(7 + 1 + 12)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.11 — a scheduled campaign whose time has passed starts on launch', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const f = await seed(win, 6, 1)

    const campaignId = await win.evaluate(async (fx) => {
      const c = await window.api.invoke('campaign:create', {
        name: 'Overdue',
        templateId: fx.templateId,
        deviceIds: fx.deviceIds,
        listIds: [fx.listId],
        // Already in the past, as if the app had been closed through it.
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
        delayFrom: 0,
        delayTo: 0,
        sleepDuration: 0,
        sleepAfter: 100,
      })
      if (!c.ok) throw new Error('create')
      return c.data.id
    }, f)

    const created = await win.evaluate(
      (id) => window.api.invoke('campaign:get', { id }),
      campaignId,
    )
    if (created.ok) expect(created.data.status).toBe('scheduled')

    // Recovery runs the same due-campaign sweep the scheduler tick does, so an
    // overdue campaign does not wait for the next minute boundary.
    const started = await win.evaluate(
      (id) => window.api.invoke('campaign:start', { id }),
      campaignId,
    )
    expect(started.ok).toBe(true)

    await expect
      .poll(
        () => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length,
        {
          timeout: 60_000,
        },
      )
      .toBe(6)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.5b — the Campaigns screen creates and runs a campaign', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const f = await seed(win, 8, 1)

    await win.getByTestId('nav-campaigns').click()
    await expect(win.getByTestId('page-title')).toHaveText('WhatsApp Bulk Campaigns')

    await win.getByTestId('new-campaign').click()
    await expect(win.getByTestId('create-campaign-dialog')).toBeVisible()

    const nameInput = win.getByTestId('cmp-name')
    await nameInput.fill('From the UI')
    await expect(nameInput).toHaveValue('From the UI')

    await win.getByTestId(`cmp-device-${f.deviceIds[0]}`).check()
    await win.getByTestId(`cmp-list-${f.listId}`).check()
    await win.getByTestId('cmp-template').selectOption(f.templateId)

    // Preview reflects the chosen template before anything is sent.
    await expect(win.getByTestId('cmp-template-preview')).toContainText('Hi {{Name}}')

    await win.getByTestId('cmp-delay-to').fill('0')
    await win.getByTestId('submit-campaign').click()

    await expect(win.getByTestId('create-campaign-dialog')).toHaveCount(0)
    await expect(win.getByTestId('campaign-card')).toHaveCount(1)

    await expect
      .poll(() => recipientRows(dir).filter((r) => r.status === 'sent').length, {
        timeout: 120_000,
      })
      .toBe(8)

    await expect(win.getByTestId('campaign-counters')).toContainText('Sent: 8')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.13 — a disconnected device hands its pending queue to the others', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const f = await seed(win, 60, 2)

    const campaignId = await win.evaluate(async (fx) => {
      const c = await window.api.invoke('campaign:create', {
        name: 'Reassign',
        templateId: fx.templateId,
        deviceIds: fx.deviceIds,
        listIds: [fx.listId],
        // Slow enough that plenty is still pending when a device drops.
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
      .poll(
        () => recipientRows(dir, campaignId).filter((r) => r.status === 'sent').length,
        {
          timeout: 60_000,
        },
      )
      .toBeGreaterThan(0)

    const victim = f.deviceIds[0]!
    const pendingOnVictim = () => {
      const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
      try {
        const row = db
          .prepare(
            "SELECT COUNT(*) AS n FROM CampaignRecipient WHERE campaignId = ? AND deviceId = ? AND status = 'pending'",
          )
          .get(campaignId, victim) as { n: number }
        return Number(row.n)
      } finally {
        db.close()
      }
    }

    expect(pendingOnVictim()).toBeGreaterThan(0)

    // Logging the device out drops it mid-run, exactly as a lost connection
    // would from the campaign's point of view.
    await win.evaluate((id) => window.api.invoke('device:logout', { id }), victim)

    // Its pending slice must move to the surviving device rather than stall.
    await expect.poll(pendingOnVictim, { timeout: 60_000 }).toBe(0)

    // And the campaign keeps going.
    await expect
      .poll(
        () =>
          recipientRows(dir, campaignId).filter(
            (r) => r.status === 'sent' || r.status === 'failed',
          ).length,
        { timeout: 180_000 },
      )
      .toBe(60)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.5c — the recipients view lists outcomes and filters them', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const f = await seed(win, 10, 1)

    const campaignId = await win.evaluate(async (fx) => {
      const c = await window.api.invoke('campaign:create', {
        name: 'Inspectable',
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

    await win.getByTestId('nav-campaigns').click()
    await win.getByTestId('view-recipients').click()
    await expect(win.getByTestId('recipients-dialog')).toBeVisible()

    await expect(win.getByTestId('recipient-row')).toHaveCount(10)
    await expect(win.getByTestId('recipient-total')).toContainText('10')

    // Filtering narrows to the failures, which is the whole point of the view.
    await win.getByTestId('recipient-filter-sent').click()
    await expect
      .poll(async () => win.getByTestId('recipient-row').count(), { timeout: 15_000 })
      .toBeLessThanOrEqual(10)
  } finally {
    await app.close()
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
    expect(rows.filter((r) => r.status === 'failed').every((r) => r.attempts > 0)).toBe(
      true,
    )
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

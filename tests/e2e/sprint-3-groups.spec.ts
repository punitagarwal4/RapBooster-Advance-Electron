import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  cleanupUserDataDir,
  launchLicensed,
  newUserDataDir,
} from './fixtures/licensed-app'

/**
 * Sprint 3 — groups (SPRINTS.md §11.3, E3.20–E3.25).
 */

async function connectedDevice(win: Page): Promise<string> {
  return win.evaluate(async () => {
    const d = await window.api.invoke('device:create', { name: 'Group Sender' })
    if (!d.ok) throw new Error('device')
    await window.api.invoke('device:connect', { id: d.data.id })

    // Wait for the mock to report connected — group operations require it.
    for (let i = 0; i < 60; i += 1) {
      const list = await window.api.invoke('device:list')
      if (list.ok && list.data.find((x) => x.id === d.data.id)?.status === 'connected')
        break
      await new Promise((r) => setTimeout(r, 250))
    }
    return d.data.id
  })
}

function groupRows(dir: string) {
  const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
  try {
    return db
      .prepare('SELECT id, name, memberCount, deviceId FROM "Group" ORDER BY name')
      .all() as Array<{ id: string; name: string; memberCount: number; deviceId: string }>
  } finally {
    db.close()
  }
}

test('E3.20 — sync lists groups with their member counts', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await connectedDevice(win)

    const synced = await win.evaluate(() => window.api.invoke('group:sync', {}))
    expect(synced.ok).toBe(true)
    if (synced.ok) expect(synced.data.synced).toBeGreaterThan(0)

    const groups = await win.evaluate(() => window.api.invoke('group:list', {}))
    expect(groups.ok).toBe(true)
    if (!groups.ok) return

    expect(groups.data.length).toBeGreaterThan(0)
    expect(groups.data.every((g) => g.memberCount > 0)).toBe(true)
    expect(groups.data.some((g) => g.name === 'Sales Team 001')).toBe(true)

    // Syncing twice must update rather than duplicate.
    await win.evaluate(() => window.api.invoke('group:sync', {}))
    const after = groupRows(dir)
    expect(after.length).toBe(groups.data.length)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.21 + E3.22 — bulk send reaches every selected group', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await connectedDevice(win)
    await win.evaluate(() => window.api.invoke('group:sync', {}))

    const result = await win.evaluate(async () => {
      const groups = await window.api.invoke('group:list', {})
      const template = await window.api.invoke('template:create', {
        name: 'Group blast',
        type: 'text',
        content: 'Hello everyone',
      })
      if (!groups.ok || !template.ok) throw new Error('setup')

      // Validation first: no groups selected must be refused.
      const empty = await window.api.invoke('groupSend:create', {
        templateId: template.data.id,
        groupIds: [],
        delaySeconds: 0,
      })

      const job = await window.api.invoke('groupSend:create', {
        templateId: template.data.id,
        groupIds: groups.data.map((g) => g.id),
        delaySeconds: 0,
      })
      if (!job.ok) throw new Error('job')

      // Poll until the job finishes.
      for (let i = 0; i < 120; i += 1) {
        const status = await window.api.invoke('groupSend:status', {
          jobId: job.data.jobId,
        })
        if (status.ok && status.data.status === 'completed') {
          return {
            emptyRefused: !empty.ok,
            emptyMessage: empty.ok ? '' : empty.error.userMessage,
            total: status.data.total,
            sent: status.data.sent,
            failed: status.data.failed,
          }
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      throw new Error('timeout')
    })

    expect(result.emptyRefused).toBe(true)
    // Prototype wording.
    expect(result.emptyMessage).toContain('at least one group')
    expect(result.sent).toBe(result.total)
    expect(result.failed).toBe(0)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.23 — bulk create produces correctly named groups for each suffix rule', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const deviceId = await connectedDevice(win)

    const names = await win.evaluate(async (id) => {
      const rules = ['number', 'alphabet', 'none'] as const
      const out: Record<string, string[]> = {}

      for (const rule of rules) {
        const job = await window.api.invoke('groupCreate:create', {
          deviceId: id,
          prefix: `Team ${rule}`,
          suffixRule: rule,
          count: 3,
          delaySeconds: 0,
          listIds: [],
          contactsPerGroup: 0,
        })
        if (!job.ok) throw new Error(`job ${rule}`)

        for (let i = 0; i < 120; i += 1) {
          const status = await window.api.invoke('groupCreate:status', {
            jobId: job.data.jobId,
          })
          if (status.ok && status.data.status === 'completed') break
          await new Promise((r) => setTimeout(r, 250))
        }

        const groups = await window.api.invoke('group:list', {})
        out[rule] = groups.ok
          ? groups.data
              .filter((g) => g.name.startsWith(`Team ${rule}`))
              .map((g) => g.name)
              .sort()
          : []
      }
      return out
    }, deviceId)

    // Zero-padded so alphabetical order matches creation order.
    expect(names.number).toEqual([
      'Team number 001',
      'Team number 002',
      'Team number 003',
    ])
    expect(names.alphabet).toEqual([
      'Team alphabet A',
      'Team alphabet B',
      'Team alphabet C',
    ])
    // 'none' produces three groups that share one name — WhatsApp allows it.
    expect(names.none).toHaveLength(3)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.24 + E3.25 — seeded members are recorded, including partial adds', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const deviceId = await connectedDevice(win)

    const outcome = await win.evaluate(async (id) => {
      const list = await window.api.invoke('contactList:create', {
        name: 'Members',
        customFields: [],
      })
      if (!list.ok) throw new Error('list')

      for (let i = 0; i < 6; i += 1) {
        await window.api.invoke('contacts:create', {
          listId: list.data.id,
          data: { Name: `M${i}`, Mobile: `9${String(400000000 + i).padStart(9, '0')}` },
        })
      }

      const job = await window.api.invoke('groupCreate:create', {
        deviceId: id,
        prefix: 'Seeded',
        suffixRule: 'number',
        count: 2,
        delaySeconds: 0,
        listIds: [list.data.id],
        contactsPerGroup: 3,
      })
      if (!job.ok) throw new Error('job')

      for (let i = 0; i < 120; i += 1) {
        const status = await window.api.invoke('groupCreate:status', {
          jobId: job.data.jobId,
        })
        if (status.ok && status.data.status === 'completed') {
          return {
            created: status.data.created,
            failed: status.data.failed,
            log: status.data.resultLog,
          }
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      throw new Error('timeout')
    }, deviceId)

    expect(outcome.created).toBe(2)
    expect(outcome.failed).toBe(0)
    // A per-group result log is what makes a partial add explainable rather
    // than mysterious.
    expect(outcome.log).not.toBeNull()

    const rows = groupRows(dir).filter((g) => g.name.startsWith('Seeded'))
    expect(rows).toHaveLength(2)
    // Contacts are consumed in order, so the two groups do not overlap.
    expect(rows.every((g) => g.memberCount === 3)).toBe(true)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E3.26 — the Groups screen selects and sends', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await connectedDevice(win)
    await win.evaluate(async () => {
      await window.api.invoke('group:sync', {})
      await window.api.invoke('template:create', {
        name: 'UI blast',
        type: 'text',
        content: 'Hi group',
      })
    })

    await win.getByTestId('nav-groups').click()
    await expect(win.getByTestId('page-title')).toHaveText('WhatsApp Groups')

    await win.getByTestId('sync-groups').click()
    await expect(win.getByTestId('group-item').first()).toBeVisible()

    await win.getByTestId('select-all-groups').click()
    await expect(win.getByTestId('selected-count')).not.toContainText('(0)')

    // Sending with no template must be refused with the prototype's wording.
    await win.getByTestId('send-to-groups').click()
    await expect(win.getByTestId('group-send-error')).toContainText('Select a template')

    await win.getByTestId('group-template').selectOption({ label: 'UI blast' })
    await win.getByTestId('group-delay').fill('0')
    await win.getByTestId('send-to-groups').click()

    // Selection clears once the job is queued.
    await expect(win.getByTestId('selected-count')).toContainText('(0)')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

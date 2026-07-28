import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupUserDataDir,
  launchLicensed,
  newUserDataDir,
} from './fixtures/licensed-app'

/**
 * E2.23–E2.25 — what a button or interactive template actually puts on the wire
 * (REQUIREMENTS §7.9).
 *
 * WHY these exist: until now the mock transport counted sends and threw the
 * payload away, so "buttons are sent as buttons" was untestable and the numbered
 * text degradation was asserted only through UI copy. The mock now appends every
 * send to WA_MOCK_SEND_LOG, which is what these specs read.
 */

interface LoggedSend {
  deviceId: string
  to: string
  message: Record<string, unknown>
}

function readSends(logPath: string): LoggedSend[] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LoggedSend)
}

/** A connected device, a one-contact list, and the template under test. */
async function seedAndSend(win: Page, template: Record<string, unknown>): Promise<void> {
  await win.evaluate(async (tpl) => {
    const list = await window.api.invoke('contactList:create', {
      name: `List ${Date.now()}`,
      customFields: [],
    })
    if (!list.ok) throw new Error('list')

    await window.api.invoke('contacts:create', {
      listId: list.data.id,
      data: { Name: 'Asha', Mobile: '+919876543210' },
    })

    const device = await window.api.invoke('device:create', { name: 'Sender' })
    if (!device.ok) throw new Error('device')
    await window.api.invoke('device:connect', { id: device.data.id })

    const created = await window.api.invoke(
      'template:create',
      tpl as Parameters<typeof window.api.invoke<'template:create'>>[1],
    )
    if (!created.ok) throw new Error(`template: ${JSON.stringify(created.error)}`)

    const campaign = await window.api.invoke('campaign:create', {
      name: `Campaign ${Date.now()}`,
      templateId: created.data.id,
      deviceIds: [device.data.id],
      listIds: [list.data.id],
      delayFrom: 0,
      delayTo: 0,
      sleepDuration: 0,
      sleepAfter: 100,
    })
    if (!campaign.ok) throw new Error('campaign')
    await window.api.invoke('campaign:start', { id: campaign.data.id })
  }, template)
}

test.describe('interactive sends', () => {
  let logPath: string
  let logDir: string

  test.beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'rapbooster-sendlog-'))
    logPath = join(logDir, 'sends.jsonl')
    // Read by the mock transport inside wa-service, which inherits this env.
    process.env.WA_MOCK_SEND_LOG = logPath
  })

  test.afterEach(() => {
    delete process.env.WA_MOCK_SEND_LOG
    rmSync(logDir, { recursive: true, force: true })
  })

  test('E2.23 — a button template sends real buttons, not numbered text', async () => {
    const dir = newUserDataDir()
    const { app, win } = await launchLicensed(dir)
    try {
      await seedAndSend(win, {
        name: 'Review',
        type: 'button',
        content: 'Hi {{Name}}, please review',
        footer: 'Reply any time',
        buttons: [
          { type: 'reply', label: 'Approve' },
          { type: 'url', label: 'Open', value: 'https://example.com/review' },
        ],
      })

      await expect.poll(() => readSends(logPath).length, { timeout: 30_000 }).toBe(1)

      const [sent] = readSends(logPath)
      expect(sent?.message).toMatchObject({
        kind: 'buttons',
        // Merge tags are resolved before the payload is built.
        body: 'Hi Asha, please review',
        footer: 'Reply any time',
        buttons: [
          { type: 'reply', label: 'Approve', id: 'btn_1' },
          {
            type: 'url',
            label: 'Open',
            value: 'https://example.com/review',
            id: 'btn_2',
          },
        ],
      })
      expect(sent?.to).toBe('+919876543210')
    } finally {
      await app.close()
      cleanupUserDataDir(dir)
    }
  })

  test('E2.24 — an interactive template sends a single-select list', async () => {
    const dir = newUserDataDir()
    const { app, win } = await launchLicensed(dir)
    try {
      await seedAndSend(win, {
        name: 'Slots',
        type: 'interactive',
        content: 'Pick a slot',
        options: ['2:00 PM', '3:00 PM'],
        listButtonText: 'Choose a time',
      })

      await expect.poll(() => readSends(logPath).length, { timeout: 30_000 }).toBe(1)

      expect(readSends(logPath)[0]?.message).toMatchObject({
        kind: 'list',
        body: 'Pick a slot',
        buttonText: 'Choose a time',
        rows: [
          { id: 'row_1', title: '2:00 PM' },
          { id: 'row_2', title: '3:00 PM' },
        ],
      })
    } finally {
      await app.close()
      cleanupUserDataDir(dir)
    }
  })

  test('E2.26 — the button editor builds a template that sends real buttons', async () => {
    const dir = newUserDataDir()
    const { app, win } = await launchLicensed(dir)
    try {
      await win.getByTestId('nav-templates').click()
      await win.getByTestId('new-template').click()

      await win.getByTestId('tpl-name').fill('Offer')
      await win.getByTestId('tpl-type').selectOption('button')
      await win.getByTestId('tpl-content').fill('Your code is inside')
      await win.getByTestId('tpl-footer').fill('Expires Friday')

      // The editor starts with no rows — a template need not have buttons at all.
      await win.getByTestId('add-button').click()
      await win.getByTestId('btn-type-0').selectOption('reply')
      await win.getByTestId('btn-label-0').fill('Tell me more')

      await win.getByTestId('add-button').click()
      await win.getByTestId('btn-type-1').selectOption('url')
      await win.getByTestId('btn-label-1').fill('Shop now')
      await win.getByTestId('btn-value-1').fill('https://example.com/sale')

      // A url button with no link must be caught here, not at send time.
      await win.getByTestId('add-button').click()
      await win.getByTestId('btn-type-2').selectOption('url')
      await win.getByTestId('btn-label-2').fill('Broken')
      await win.getByTestId('submit-template').click()
      await expect(win.getByTestId('template-error')).toContainText('Broken')

      await win.getByTestId('btn-remove-2').click()
      await win.getByTestId('submit-template').click()
      await expect(win.getByTestId('create-template-dialog')).toHaveCount(0)

      const sent = await win.evaluate(async () => {
        const templates = await window.api.invoke('template:list')
        if (!templates.ok) throw new Error('templates')
        const template = templates.data.find((t) => t.name === 'Offer')
        if (!template) throw new Error('missing template')

        const list = await window.api.invoke('contactList:create', {
          name: 'Buyers',
          customFields: [],
        })
        if (!list.ok) throw new Error('list')
        await window.api.invoke('contacts:create', {
          listId: list.data.id,
          data: { Name: 'Asha', Mobile: '+919876543210' },
        })

        const device = await window.api.invoke('device:create', { name: 'Sender' })
        if (!device.ok) throw new Error('device')
        await window.api.invoke('device:connect', { id: device.data.id })

        const campaign = await window.api.invoke('campaign:create', {
          name: 'Offer run',
          templateId: template.id,
          deviceIds: [device.data.id],
          listIds: [list.data.id],
          delayFrom: 0,
          delayTo: 0,
          sleepDuration: 0,
          sleepAfter: 100,
        })
        if (!campaign.ok) throw new Error('campaign')
        await window.api.invoke('campaign:start', { id: campaign.data.id })
        return true
      })
      expect(sent).toBe(true)

      await expect.poll(() => readSends(logPath).length, { timeout: 30_000 }).toBe(1)

      expect(readSends(logPath)[0]?.message).toMatchObject({
        kind: 'buttons',
        body: 'Your code is inside',
        footer: 'Expires Friday',
        buttons: [
          { type: 'reply', label: 'Tell me more' },
          { type: 'url', label: 'Shop now', value: 'https://example.com/sale' },
        ],
      })
    } finally {
      await app.close()
      cleanupUserDataDir(dir)
    }
  })

  test('E2.25 — a group send carries the template, not just its body', async () => {
    const dir = newUserDataDir()
    const { app, win } = await launchLicensed(dir)
    try {
      // Group sends used to build plain text regardless of template type, so a
      // button template lost its buttons on the way to a group. Same builder now.
      const started = await win.evaluate(async () => {
        const device = await window.api.invoke('device:create', { name: 'Grouper' })
        if (!device.ok) throw new Error('device')
        await window.api.invoke('device:connect', { id: device.data.id })

        // Group operations need the socket up; the mock reports connected a
        // moment after connect() returns.
        for (let i = 0; i < 60; i += 1) {
          const list = await window.api.invoke('device:list')
          const status = list.ok
            ? list.data.find((d) => d.id === device.data.id)?.status
            : undefined
          if (status === 'connected') break
          await new Promise((r) => setTimeout(r, 250))
        }
        await window.api.invoke('group:sync', {})

        const groups = await window.api.invoke('group:list', {})
        if (!groups.ok || groups.data.length === 0) throw new Error('groups')

        const template = await window.api.invoke('template:create', {
          name: 'Group buttons',
          type: 'button',
          content: 'Team update',
          buttons: [{ type: 'reply', label: 'Seen' }],
        })
        if (!template.ok) throw new Error('template')

        const job = await window.api.invoke('groupSend:create', {
          templateId: template.data.id,
          groupIds: [groups.data[0]!.id],
          delaySeconds: 0,
        })
        return job.ok
      })
      expect(started).toBe(true)

      await expect
        .poll(() => readSends(logPath).length, { timeout: 30_000 })
        .toBeGreaterThan(0)

      expect(readSends(logPath)[0]?.message).toMatchObject({
        kind: 'buttons',
        body: 'Team update',
        buttons: [{ type: 'reply', label: 'Seen', id: 'btn_1' }],
      })
    } finally {
      await app.close()
      cleanupUserDataDir(dir)
    }
  })
})

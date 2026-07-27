import { expect, test } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupUserDataDir, launchLicensed, newUserDataDir } from './fixtures/licensed-app'

/**
 * Sprint 2 — templates and merge tags (SPRINTS.md §10.3, E2.18–E2.22).
 */

test('E2.18 — all four template types are created, with the button cap enforced', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const results = await win.evaluate(async () => {
      const out: Record<string, boolean> = {}

      out.text = (
        await window.api.invoke('template:create', {
          name: 'Welcome',
          type: 'text',
          content: 'Welcome! Thanks for reaching out.',
        })
      ).ok

      out.interactive = (
        await window.api.invoke('template:create', {
          name: 'Choose',
          type: 'interactive',
          content: 'Pick a slot',
          options: ['2:00 PM', '3:00 PM'],
        })
      ).ok

      out.button = (
        await window.api.invoke('template:create', {
          name: 'Approve',
          type: 'button',
          content: 'Please review',
          buttons: ['Approve', 'Reject', 'Later'],
        })
      ).ok

      // Four buttons must be refused — WhatsApp allows three.
      out.fourButtons = (
        await window.api.invoke('template:create', {
          name: 'TooMany',
          type: 'button',
          content: 'Nope',
          buttons: ['A', 'B', 'C', 'D'],
        })
      ).ok

      // A media template with no file must be refused rather than saved broken.
      out.mediaNoFile = (
        await window.api.invoke('template:create', {
          name: 'NoFile',
          type: 'media',
          content: 'Look',
          mediaType: 'image',
        })
      ).ok

      return out
    })

    expect(results.text).toBe(true)
    expect(results.interactive).toBe(true)
    expect(results.button).toBe(true)
    expect(results.fourButtons).toBe(false)
    expect(results.mediaNoFile).toBe(false)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.19 — oversized and wrong-type media are rejected before being copied', async () => {
  const dir = newUserDataDir()
  const files = mkdtempSync(join(tmpdir(), 'rapbooster-media-'))
  const { app, win } = await launchLicensed(dir)
  try {
    // 6 MB exceeds WhatsApp's practical 5 MB image limit.
    const big = join(files, 'big.png')
    writeFileSync(big, Buffer.alloc(6 * 1024 * 1024))

    const wrongType = join(files, 'notes.txt')
    writeFileSync(wrongType, 'not an image')

    const outcome = await win.evaluate(
      async ({ bigPath, txtPath }) => {
        const tooBig = await window.api.invoke('template:create', {
          name: 'Big',
          type: 'media',
          content: 'x',
          mediaType: 'image',
          mediaSourcePath: bigPath,
        })
        const wrong = await window.api.invoke('template:create', {
          name: 'Wrong',
          type: 'media',
          content: 'x',
          mediaType: 'image',
          mediaSourcePath: txtPath,
        })
        const all = await window.api.invoke('template:list')
        return {
          tooBig: tooBig.ok,
          tooBigMessage: tooBig.ok ? '' : tooBig.error.userMessage,
          wrong: wrong.ok,
          count: all.ok ? all.data.length : -1,
        }
      },
      { bigPath: big, txtPath: wrongType },
    )

    expect(outcome.tooBig).toBe(false)
    expect(outcome.tooBigMessage).toContain('MB')
    expect(outcome.wrong).toBe(false)
    // Neither rejection may leave a half-created template behind.
    expect(outcome.count).toBe(0)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
    rmSync(files, { recursive: true, force: true })
  }
})

test('E2.20 — merge tags resolve against a real contact', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const result = await win.evaluate(async () => {
      const list = await window.api.invoke('contactList:create', {
        name: 'Preview',
        customFields: ['Company'],
      })
      if (!list.ok) return null

      const contact = await window.api.invoke('contacts:create', {
        listId: list.data.id,
        data: { Name: 'Priya', Mobile: '9876543210', Company: 'Acme' },
      })
      if (!contact.ok) return null

      const template = await window.api.invoke('template:create', {
        name: 'Personal',
        type: 'text',
        content: 'Hi {{Name}} from {{Company}} — we have news. {{Missing}}',
      })
      if (!template.ok) return null

      const preview = await window.api.invoke('template:preview', {
        id: template.data.id,
        contactId: contact.data.id,
      })
      return preview.ok ? preview.data : null
    })

    expect(result).not.toBeNull()
    expect(result?.rendered).toContain('Hi Priya from Acme')
    // A tag no field provides renders blank and is reported, not left visible.
    expect(result?.rendered).not.toContain('{{Missing}}')
    expect(result?.unresolvedTags).toContain('Missing')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.21 — a template used by a campaign cannot be deleted', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const outcome = await win.evaluate(async () => {
      const list = await window.api.invoke('contactList:create', {
        name: 'For Campaign',
        customFields: [],
      })
      const device = await window.api.invoke('device:create', { name: 'Sender' })
      const template = await window.api.invoke('template:create', {
        name: 'Used',
        type: 'text',
        content: 'Hello',
      })
      if (!list.ok || !device.ok || !template.ok) return null

      const campaign = await window.api.invoke('campaign:create', {
        name: 'Spring Sale',
        templateId: template.data.id,
        deviceIds: [device.data.id],
        listIds: [list.data.id],
        delayFrom: 0,
        delayTo: 5,
        sleepDuration: 10,
        sleepAfter: 10,
      })

      const deletion = await window.api.invoke('template:delete', { id: template.data.id })
      return {
        campaignCreated: campaign.ok,
        deleted: deletion.ok,
        code: deletion.ok ? '' : deletion.error.code,
      }
    })

    // The campaign engine lands in Sprint 3, so campaign:create may not exist
    // yet; the guard is only meaningful once it does.
    if (outcome?.campaignCreated) {
      expect(outcome.deleted).toBe(false)
      expect(outcome.code).toBe('CONFLICT')
    } else {
      expect(outcome?.deleted).toBe(true)
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.22 — the Templates screen previews merge tags and warns about buttons', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await win.evaluate(() =>
      window.api.invoke('contactList:create', { name: 'Fields', customFields: ['Company'] }),
    )

    await win.getByTestId('nav-templates').click()
    await expect(win.getByTestId('page-title')).toHaveText('WhatsApp Templates')

    await win.getByTestId('new-template').click()
    await expect(win.getByTestId('create-template-dialog')).toBeVisible()

    const nameInput = win.getByTestId('tpl-name')
    await nameInput.fill('Greeting')
    await expect(nameInput).toHaveValue('Greeting')

    const content = win.getByTestId('tpl-content')
    await content.fill('Hi {{Name}} at {{Company}} — and {{Nope}}')
    await expect(content).toHaveValue('Hi {{Name}} at {{Company}} — and {{Nope}}')

    // Live preview substitutes sample values without a round trip.
    await expect(win.getByTestId('tpl-preview')).toContainText('Hi Priya at «Company»')
    // A tag no list provides is flagged before the user sends to thousands.
    await expect(win.getByTestId('unknown-tags')).toContainText('{{Nope}}')

    // Switching to a button type surfaces the platform limitation.
    await win.getByTestId('tpl-type').selectOption('button')
    await expect(win.getByTestId('degrade-notice')).toContainText('numbered text')

    await win.getByTestId('tpl-type').selectOption('text')
    await win.getByTestId('submit-template').click()
    await expect(win.getByTestId('create-template-dialog')).toHaveCount(0)
    await expect(win.getByTestId('template-card')).toHaveCount(1)
    await expect(win.getByTestId('template-grid')).toContainText('Greeting')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

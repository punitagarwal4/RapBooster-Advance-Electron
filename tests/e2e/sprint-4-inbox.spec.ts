import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { activateWith, cleanupUserDataDir, newUserDataDir } from './fixtures/licensed-app'
import { APP_READY_TIMEOUT_MS } from './fixtures/constants'

/**
 * Sprint 4 — inbox (SPRINTS.md §12.3, E4.1–E4.7).
 *
 * These launch with WA_MOCK_INCOMING so the mock transport produces inbound
 * traffic on connect; the standard fixture does not, because most specs should
 * not have messages arriving underneath them.
 */
async function launchWithInbound(
  dir: string,
  count = 2,
): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${dir}`],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: undefined,
      LICENSE_SERVICE: 'mock',
      WA_TRANSPORT: 'mock',
      WA_MOCK_INCOMING: String(count),
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv,
  })

  const win = await app.firstWindow()
  await win
    .locator('[data-testid="license-key"], [data-testid="nav-dashboard"]')
    .first()
    .waitFor({ state: 'visible', timeout: APP_READY_TIMEOUT_MS })
  if (await win.getByTestId('license-key').isVisible()) {
    await activateWith(win, 'VALID-E2E-0001')
  }
  await win
    .getByTestId('nav-dashboard')
    .waitFor({ state: 'visible', timeout: APP_READY_TIMEOUT_MS })
  return { app, win }
}

async function connectDevice(win: Page): Promise<string> {
  return win.evaluate(async () => {
    const d = await window.api.invoke('device:create', { name: 'Inbox Device' })
    if (!d.ok) throw new Error('device')
    await window.api.invoke('device:connect', { id: d.data.id })
    for (let i = 0; i < 80; i += 1) {
      const list = await window.api.invoke('device:list')
      if (list.ok && list.data.find((x) => x.id === d.data.id)?.status === 'connected')
        break
      await new Promise((r) => setTimeout(r, 250))
    }
    return d.data.id
  })
}

function messageRows(dir: string) {
  const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
  try {
    return db
      .prepare(
        'SELECT id, chatId, direction, body, status FROM Message ORDER BY timestamp',
      )
      .all() as Array<{
      id: string
      chatId: string
      direction: string
      body: string | null
      status: string
    }>
  } finally {
    db.close()
  }
}

test('E4.1 — an incoming message creates a chat and appears in the list', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchWithInbound(dir, 2)
  try {
    await connectDevice(win)

    await expect
      .poll(() => messageRows(dir).length, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(2)

    await win.getByTestId('nav-inbox').click()
    await expect(win.getByTestId('page-title')).toHaveText('Unified inbox')
    await expect(win.getByTestId('chat-item').first()).toBeVisible()

    // An unread badge until the chat is opened.
    await expect(win.getByTestId('unread-badge').first()).toBeVisible()

    await win.getByTestId('chat-item').first().click()
    await expect(win.getByTestId('message-bubble').first()).toBeVisible()
    await expect(win.getByTestId('message-thread')).toContainText('Mock inbound')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.6 — opening a chat clears its unread badge', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchWithInbound(dir, 1)
  try {
    await connectDevice(win)
    await expect
      .poll(() => messageRows(dir).length, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(1)

    await win.getByTestId('nav-inbox').click()
    await expect(win.getByTestId('unread-badge').first()).toBeVisible()

    await win.getByTestId('chat-item').first().click()
    await expect(win.getByTestId('unread-badge')).toHaveCount(0, { timeout: 15_000 })
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.4 — sending from the composer stores an outgoing message', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchWithInbound(dir, 1)
  try {
    await connectDevice(win)
    await expect
      .poll(() => messageRows(dir).length, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(1)

    await win.getByTestId('nav-inbox').click()
    await win.getByTestId('chat-item').first().click()
    await expect(win.getByTestId('message-bubble').first()).toBeVisible()

    const input = win.getByTestId('message-input')
    await input.fill('Reply from the composer')
    await expect(input).toHaveValue('Reply from the composer')
    await win.getByTestId('send-message').click()

    await expect
      .poll(() => messageRows(dir).filter((m) => m.direction === 'out').length, {
        timeout: 30_000,
      })
      .toBe(1)

    const sent = messageRows(dir).find((m) => m.direction === 'out')
    expect(sent?.body).toBe('Reply from the composer')
    await expect(win.getByTestId('message-thread')).toContainText(
      'Reply from the composer',
    )
    // The input clears once the message is away.
    await expect(input).toHaveValue('')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.1b — messages survive a restart and duplicates are ignored', async () => {
  const dir = newUserDataDir()
  let session = await launchWithInbound(dir, 2)
  let before: number
  try {
    await connectDevice(session.win)
    await expect
      .poll(() => messageRows(dir).length, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(2)
    before = messageRows(dir).length
  } finally {
    await session.app.close()
  }

  // Relaunch with inbound disabled: the stored history must still be there, and
  // the reconnect must not duplicate what was already recorded.
  session = await launchWithInbound(dir, 0)
  try {
    await session.win.getByTestId('nav-inbox').click()
    await expect(session.win.getByTestId('chat-item').first()).toBeVisible()

    const after = messageRows(dir)
    expect(after.length).toBe(before)

    const ids = new Set(after.map((m) => m.id))
    expect(ids.size).toBe(after.length)
  } finally {
    await session.app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.2 + E4.3 — the device filter and chat search narrow the list', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchWithInbound(dir, 2)
  try {
    const deviceId = await connectDevice(win)
    await expect
      .poll(() => messageRows(dir).length, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(2)

    await win.getByTestId('nav-inbox').click()
    // Wait for the list to render before counting — `count()` does not wait,
    // so reading it immediately after navigation returns zero.
    await expect(win.getByTestId('chat-item').first()).toBeVisible()
    const initial = await win.getByTestId('chat-item').count()
    expect(initial).toBeGreaterThan(0)

    // Filtering to the only connected device keeps everything.
    await win.getByTestId('chat-device-filter').selectOption(deviceId)
    await expect.poll(async () => win.getByTestId('chat-item').count()).toBe(initial)

    // A search that matches nothing empties the list.
    await win.getByTestId('chat-search').fill('zzz-no-such-contact')
    await expect.poll(async () => win.getByTestId('chat-item').count()).toBe(0)

    await win.getByTestId('chat-search').fill('')
    await expect.poll(async () => win.getByTestId('chat-item').count()).toBe(initial)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

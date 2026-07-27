import { _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from './fixtures/electron-app'

/**
 * Sprint 1 E2E. Test IDs map to SPRINTS.md §9.3 so the spec and the suite stay
 * in sync. Licensing cases (E1.1–E1.9) arrive with T1.8.
 *
 * WHY node:sqlite and not better-sqlite3: `electron-builder install-app-deps`
 * rebuilds better-sqlite3 for Electron's ABI (146), so it cannot load in
 * Playwright's plain-Node runner (ABI 137). Node's built-in SQLite has no
 * native-ABI coupling and reads the same file.
 */

/** Inspect the database file directly, read-only. */
function inspectSchema(userData: string) {
  const db = new DatabaseSync(join(userData, 'rapbooster.db'), { readOnly: true })
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => String((r as { name: string }).name))
    const applied = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number }
    const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    const quick = db.prepare('PRAGMA quick_check').get() as { quick_check: string }
    return {
      tables,
      appliedCount: Number(applied.n),
      journalMode: String(journal.journal_mode),
      quickCheck: String(quick.quick_check),
    }
  } finally {
    db.close()
  }
}

test('E1.10 — window opens and the renderer loads', async ({ app }) => {
  const win = await app.firstWindow()
  await expect(win.getByTestId('renderer-ready')).toBeVisible()
  await expect(win).toHaveTitle(/RapBooster Advance/)
})

test('E1.10b — renderer reports no console errors on load', async ({ app }) => {
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  win.on('pageerror', (err) => errors.push(err.message))

  await expect(win.getByTestId('renderer-ready')).toBeVisible()
  expect(errors).toEqual([])
})

test('E1.12 — database is created under the isolated userData path', async ({ app }) => {
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))

  expect(userData).toContain('rapbooster-e2e-')
  expect(existsSync(join(userData, 'rapbooster.db'))).toBe(true)
  // Backups directory is created as part of the boot sequence.
  expect(existsSync(join(userData, 'backups'))).toBe(true)
})

test('E1.13 — migrations run from empty and create the full schema', async ({ app }) => {
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const { tables, appliedCount } = inspectSchema(userData)

  // Every model in SPRINTS.md §4, plus the migrator's own tracking table.
  const expected = [
    'License',
    'Device',
    'ContactList',
    'Contact',
    'Template',
    'Campaign',
    'CampaignDevice',
    'CampaignList',
    'CampaignRecipient',
    'Group',
    'GroupSendJob',
    'GroupSendTarget',
    'GroupCreateJob',
    'Chat',
    'Message',
    'ChatbotConfig',
    'Setting',
    '_migrations',
  ]
  for (const table of expected) {
    expect(tables).toContain(table)
  }

  // The spike table must not survive into the shipped schema (tracker K2).
  expect(tables).not.toContain('SpikeProbe')
  expect(appliedCount).toBeGreaterThan(0)
})

test('E1.13b — database is in WAL mode and passes its integrity check', async ({ app }) => {
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const { journalMode, quickCheck } = inspectSchema(userData)
  expect(journalMode).toBe('wal')
  expect(quickCheck).toBe('ok')
})

test('E1.13c — the boot sequence is idempotent across a real restart', async () => {
  // Deliberately does not use the `app` fixture: proving the migrator is a safe
  // no-op on every launch requires actually launching twice against one
  // database, which means owning the lifecycle here.
  const userDataDir = mkdtempSync(join(tmpdir(), 'rapbooster-e2e-restart-'))
  const launch = () =>
    electron.launch({
      args: ['out/main/index.js', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: undefined } as NodeJS.ProcessEnv,
    })

  try {
    const first = await launch()
    await first.firstWindow()
    const before = inspectSchema(userDataDir)
    await first.close()

    const second = await launch()
    await second.firstWindow()
    const after = inspectSchema(userDataDir)
    await second.close()

    expect(before.appliedCount).toBeGreaterThan(0)
    expect(after.appliedCount).toBe(before.appliedCount)
    expect(after.tables.sort()).toEqual(before.tables.sort())
    expect(after.quickCheck).toBe('ok')
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('E1.14 — renderer is sandboxed with no Node access', async ({ app }) => {
  const win = await app.firstWindow()
  await expect(win.getByTestId('renderer-ready')).toBeVisible()

  const exposure = await win.evaluate(() => ({
    hasRequire: typeof (globalThis as Record<string, unknown>).require !== 'undefined',
    hasProcess: typeof (globalThis as Record<string, unknown>).process !== 'undefined',
    hasApi: typeof (globalThis as Record<string, unknown>).api !== 'undefined',
  }))

  expect(exposure.hasRequire).toBe(false)
  expect(exposure.hasProcess).toBe(false)
  // The preload bridge is the only channel through (CLAUDE.md §2.1).
  expect(exposure.hasApi).toBe(true)
})

test('E1.14b — IPC round-trips through the contract', async ({ app }) => {
  const win = await app.firstWindow()
  await expect(win.getByTestId('renderer-ready')).toBeVisible()

  // Rendered from live IPC data, so its presence proves preload → router →
  // handler → response validation all work.
  await expect(win.getByTestId('version-info')).toBeVisible()
  await expect(win.getByTestId('dashboard-stats')).toBeVisible()

  const result = await win.evaluate(() => window.api.invoke('system:version'))
  expect(result.ok).toBe(true)
})

test('E1.14c — malformed request is rejected with VALIDATION_FAILED', async ({ app }) => {
  const win = await app.firstWindow()
  await expect(win.getByTestId('renderer-ready')).toBeVisible()

  const result = await win.evaluate(() =>
    // Deliberately wrong shape: openPath requires { path: string }.
    window.api.invoke('system:openPath', { wrong: 'shape' } as never),
  )

  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
})

test('E1.14d — unknown channels are refused by the preload allowlist', async ({ app }) => {
  const win = await app.firstWindow()
  await expect(win.getByTestId('renderer-ready')).toBeVisible()

  const result = await win.evaluate(() =>
    window.api.invoke('totally:not:a:channel' as never, undefined as never),
  )

  expect(result.ok).toBe(false)
})

test('E1.14e — openPath outside userData is refused', async ({ app }) => {
  const win = await app.firstWindow()
  await expect(win.getByTestId('renderer-ready')).toBeVisible()

  const result = await win.evaluate(() =>
    window.api.invoke('system:openPath', { path: 'C:\\Windows\\System32' }),
  )

  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
})

test('E1.3 — a strict CSP is applied to the renderer', async ({ app }) => {
  const win = await app.firstWindow()
  await expect(win.getByTestId('renderer-ready')).toBeVisible()

  // Inline script must be blocked by script-src 'self'.
  const inlineScriptRan = await win.evaluate(() => {
    try {
      const el = document.createElement('script')
      el.textContent = 'window.__cspBypassed = true'
      document.head.appendChild(el)
    } catch {
      return false
    }
    return (window as unknown as { __cspBypassed?: boolean }).__cspBypassed === true
  })

  expect(inlineScriptRan).toBe(false)
})

test('E1.16 — build artifacts the smoke test depends on are present', async () => {
  expect(existsSync(join('out', 'main', 'index.js'))).toBe(true)
  expect(existsSync(join('out', 'main', 'self-test.js'))).toBe(true)
  expect(existsSync(join('renderer', 'out', 'index.html'))).toBe(true)
  expect(existsSync(join('out', 'renderer', 'index.html'))).toBe(true)
})

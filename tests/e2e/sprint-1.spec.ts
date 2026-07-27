import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './fixtures/electron-app'

/**
 * Sprint 1 E2E. Test IDs map to SPRINTS.md §9.3 so the spec and the suite stay
 * in sync. Licensing cases (E1.1–E1.9) arrive with T1.8; these cover the
 * scaffold and shell that T1.2/T1.3 deliver.
 */

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

  // The boot migrator lands in T1.4; until then assert the path itself is
  // isolated, which is what makes every other DB assertion trustworthy.
  expect(userData).toContain('rapbooster-e2e-')
  expect(existsSync(userData)).toBe(true)
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

test('E1.16 — packaged self-test artifacts are present in the build', async () => {
  // Guards the smoke-test contract: scripts/smoke.mjs depends on these existing.
  expect(existsSync(join('out', 'main', 'index.js'))).toBe(true)
  expect(existsSync(join('out', 'main', 'spike.js'))).toBe(true)
  expect(existsSync(join('renderer', 'out', 'index.html'))).toBe(true)
})

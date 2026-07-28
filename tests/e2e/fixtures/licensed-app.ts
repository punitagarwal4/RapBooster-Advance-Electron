import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { APP_READY_TIMEOUT_MS as READY_TIMEOUT_MS } from './constants'

/**
 * Launch helpers for licensing specs, which need control over the userData
 * directory across restarts — the standard `app` fixture throws its directory
 * away between tests, which is exactly what a persistence test must not do.
 *
 * LICENSE_SERVICE=mock selects the deterministic implementation, so every
 * branch (valid, invalid, expired, revoked, conflict, offline) is reachable
 * without a network or a real license server.
 */
export function newUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'rapbooster-lic-'))
}

export function cleanupUserDataDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Fill the activation form and submit.
 *
 * WHY it asserts the value before clicking: the inputs are React-controlled, so
 * their state only updates once hydration has attached the change handler.
 * Clicking Activate before then submits an empty form and the test fails with
 * "License key is required." — a race, not a bug in the app. A controlled input
 * renders its value from state, so seeing the value in the DOM proves state is
 * in sync.
 */
export async function activateWith(
  win: Page,
  key: string,
  remarks?: string,
): Promise<void> {
  const keyInput = win.getByTestId('license-key')
  await keyInput.fill(key)
  await expect(keyInput).toHaveValue(key)

  if (remarks !== undefined) {
    const remarksInput = win.getByTestId('license-remarks')
    await remarksInput.fill(remarks)
    await expect(remarksInput).toHaveValue(remarks)
  }

  await win.getByTestId('license-activate').click()
}

/**
 * Launch and end up inside the licensed application.
 *
 * Activation only happens on a fresh userData directory; on a relaunch the
 * stored license is still valid and the app opens straight to the dashboard,
 * so there is no key field to fill.
 */
export async function launchLicensed(
  userDataDir: string,
  key = 'VALID-E2E-0001',
): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await launchWith(userDataDir)
  const win = await app.firstWindow()

  // Wait for whichever screen renders before deciding. `isVisible()` does not
  // wait, so on a slow first paint it returns false and a fresh install would
  // skip activation entirely.
  await win
    .locator('[data-testid="license-key"], [data-testid="nav-dashboard"]')
    .first()
    .waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS })

  if (await win.getByTestId('license-key').isVisible()) {
    await activateWith(win, key)
  }

  await win
    .getByTestId('nav-dashboard')
    .waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS })
  return { app, win }
}

export async function launchWith(userDataDir: string): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: undefined,
      LICENSE_SERVICE: 'mock',
      WA_TRANSPORT: 'mock',
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv,
  })
  await app.firstWindow()
  return app
}

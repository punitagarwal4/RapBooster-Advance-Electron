import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, test as base, type ElectronApplication } from '@playwright/test'

/**
 * Launches the built app with a throwaway userData directory.
 *
 * WHY isolated userData: the app creates its SQLite database under
 * app.getPath('userData'). Sharing that between specs would let one test's rows
 * leak into another's assertions, and would clobber the developer's real data.
 */
export const test = base.extend<{ app: ElectronApplication }>({
  // Playwright requires the first argument to be an object-destructuring
  // pattern even when no fixtures are consumed, so the empty pattern is load-
  // bearing rather than an oversight.
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'rapbooster-e2e-'))

    const app = await electron.launch({
      args: ['out/main/index.js', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        // Unset so the app loads the static export, exercising the same path
        // the packaged build uses rather than a dev server.
        ELECTRON_RENDERER_URL: undefined,
        LICENSE_SERVICE: 'mock',
        WA_TRANSPORT: 'mock',
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv,
    })

    // The window is only created after the database boot sequence completes, so
    // waiting for it is a reliable barrier. Without this, tests that assert on
    // the database race the migrator and fail intermittently.
    const win = await app.firstWindow()

    // Activate through the real UI rather than seeding the database or adding a
    // test-only bypass: a shortcut here would let the gate rot undetected, and
    // these specs are about what happens *after* activation.
    // 60s because the first launch of a run absorbs module loading, Prisma
    // initialisation and V8 warm-up — the same cold start that made this fail
    // as the first test of a suite while passing in isolation.
    await win.getByTestId('license-key').waitFor({ state: 'visible', timeout: 60_000 })
    await win.getByTestId('license-key').fill('VALID-E2E-0001')
    await win.getByTestId('license-activate').click()
    await win.getByTestId('nav-dashboard').waitFor({ state: 'visible', timeout: 60_000 })

    await use(app)

    await app.close()
    rmSync(userDataDir, { recursive: true, force: true })
  },
})

export { expect } from '@playwright/test'

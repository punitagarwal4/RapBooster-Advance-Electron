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
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv,
    })

    // The window is only created after the database boot sequence completes, so
    // waiting for it is a reliable barrier. Without this, tests that assert on
    // the database race the migrator and fail intermittently.
    await app.firstWindow()

    await use(app)

    await app.close()
    rmSync(userDataDir, { recursive: true, force: true })
  },
})

export { expect } from '@playwright/test'

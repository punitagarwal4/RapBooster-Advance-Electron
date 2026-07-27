import { _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Launch and discard the app once before the suite runs.
 *
 * WHY: the first launch after a build pages a ~200 MB Electron binary and the
 * freshly written bundles in from disk, which on a loaded machine took over 90
 * seconds — while the same test ran in 1.4 s once warm. Without this, the first
 * test of a run absorbs that entire cost and fails on a budget that is
 * perfectly adequate for the work it actually does. Paying it here keeps every
 * per-test timeout meaningful instead of being a proxy for disk warm-up.
 */
export default async function globalSetup(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'rapbooster-warmup-'))
  const started = Date.now()

  try {
    const app = await electron.launch({
      args: ['out/main/index.js', `--user-data-dir=${dir}`],
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: undefined,
        LICENSE_SERVICE: 'mock',
        WA_TRANSPORT: 'mock',
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv,
      timeout: 180_000,
    })
    const win = await app.firstWindow()
    // Waiting for real content means the renderer bundle is warm too, not just
    // the main process.
    await win.locator('[data-testid="license-key"]').waitFor({ timeout: 120_000 })
    await app.close()
    console.log(`e2e warm-up completed in ${Math.round((Date.now() - started) / 1000)}s`)
  } catch (err) {
    // A failed warm-up must not fail the suite — the tests themselves will
    // report the real problem with far better diagnostics.
    console.warn('e2e warm-up failed (continuing):', err)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

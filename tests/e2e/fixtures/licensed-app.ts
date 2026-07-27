import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

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

export async function launchWith(userDataDir: string): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: undefined,
      LICENSE_SERVICE: 'mock',
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv,
  })
  await app.firstWindow()
  return app
}

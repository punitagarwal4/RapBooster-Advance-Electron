/**
 * Filesystem layout (SPRINTS.md §3.4). Every runtime path resolves from
 * app.getPath('userData'), which Electron scopes to the OS user account —
 * that is what satisfies the "one database per user" requirement without any
 * in-app profile system.
 */
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join, normalize } from 'node:path'

export const DB_FILENAME = 'rapbooster.db'

export function userDataDir(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function databasePath(): string {
  return join(userDataDir(), DB_FILENAME)
}

/** Prisma's driver adapter takes a `file:` URL, not a bare path. */
export function databaseUrl(): string {
  return `file:${databasePath()}`
}

export function backupsDir(): string {
  const dir = join(userDataDir(), 'backups')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function sessionsDir(): string {
  const dir = join(userDataDir(), 'sessions')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function mediaDir(...segments: string[]): string {
  const dir = join(userDataDir(), 'media', ...segments)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function logsDir(): string {
  const dir = join(userDataDir(), 'logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Locate prisma/migrations across dev and packaged layouts.
 *
 * WHY a candidate list: app.getAppPath() is not reliable in dev — launching
 * `electron out/main/index.js` makes it return out/main, not the repo root. In
 * a packaged build the migrations live inside app.asar. Probing an ordered list
 * beats trusting any single anchor, and a hard failure beats silently running
 * against an unmigrated database.
 */
export function migrationsDir(): string {
  const rel = ['prisma', 'migrations'] as const
  const candidates = app.isPackaged
    ? [
        join(app.getAppPath(), ...rel),
        join(process.resourcesPath, 'app.asar', ...rel),
        join(process.resourcesPath, ...rel),
      ]
    : [
        join(process.cwd(), ...rel),
        join(app.getAppPath(), ...rel),
        join(__dirname, '..', '..', '..', ...rel),
      ]
  return normalize(candidates.find((c) => existsSync(c)) ?? candidates[0]!)
}

/**
 * Database backups (CLAUDE.md §5.3).
 *
 * A backup is taken automatically before any migration runs. Migrations are
 * forward-only, so if one corrupts data there is otherwise no way back — and on
 * a desktop app the user's contact lists and campaign history are not
 * reproducible from anywhere else.
 */
import Database from 'better-sqlite3'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

export const RETAIN_BACKUPS = 5

/**
 * Uses SQLite's online backup API rather than a file copy: copying a database
 * with an active WAL can capture a torn state, whereas VACUUM INTO always
 * produces a consistent, fully-checkpointed snapshot.
 */
export async function createBackup(
  dbPath: string,
  destDir: string,
  label = 'auto',
): Promise<string | null> {
  if (!existsSync(dbPath)) return null

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(destDir, `${basename(dbPath, '.db')}-${label}-${stamp}.db`)

  const db = new Database(dbPath, { readonly: true })
  try {
    // VACUUM INTO refuses to overwrite, which is the behaviour we want.
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  } finally {
    db.close()
  }

  pruneBackups(destDir)
  return target
}

/** Keep the newest RETAIN_BACKUPS files; older ones are removed. */
export function pruneBackups(destDir: string, retain = RETAIN_BACKUPS): string[] {
  if (!existsSync(destDir)) return []

  const backups = readdirSync(destDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ file: f, mtime: statSync(join(destDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  const removed: string[] = []
  for (const { file } of backups.slice(retain)) {
    rmSync(join(destDir, file), { force: true })
    removed.push(file)
  }
  return removed
}

export function listBackups(destDir: string): Array<{ file: string; size: number; mtime: number }> {
  if (!existsSync(destDir)) return []
  return readdirSync(destDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const s = statSync(join(destDir, f))
      return { file: f, size: s.size, mtime: s.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

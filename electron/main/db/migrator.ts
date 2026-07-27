/**
 * Boot migrator.
 *
 * WHY we don't shell out to `prisma migrate deploy`: the Prisma CLI must not be
 * a runtime dependency of a shipped desktop app. Migrations are emitted as plain
 * SQL at development time and applied here with the same better-sqlite3 driver
 * the app already loads.
 *
 * Migrations are forward-only and each runs inside a transaction, so a failure
 * leaves the database on the last good version rather than half-migrated.
 */
import Database from 'better-sqlite3'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface MigrationResult {
  applied: string[]
  alreadyApplied: number
}

const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
    checksum    TEXT
  )
`

/** Cheap, stable content fingerprint — enough to catch an edited migration. */
function checksum(sql: string): string {
  let h = 5381
  for (let i = 0; i < sql.length; i += 1) {
    h = ((h << 5) + h + sql.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

export function pendingMigrations(db: Database.Database, dir: string): string[] {
  if (!existsSync(dir)) return []

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  )

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !applied.has(name))
    .filter((name) => existsSync(join(dir, name, 'migration.sql')))
    .sort()
}

/**
 * Apply every pending migration. Safe to call on every launch — it is a no-op
 * once the database is current, which is what makes it a boot step rather than
 * a special-case upgrade path.
 */
export function runMigrations(dbPath: string, dir: string): MigrationResult {
  const db = new Database(dbPath)
  try {
    // WAL survives in the database file itself, but setting it here means a
    // brand-new database is created in the right mode from its first write.
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    db.exec(TRACKING_TABLE)

    const alreadyApplied = (
      db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number }
    ).n

    const pending = pendingMigrations(db, dir)
    const record = db.prepare('INSERT INTO _migrations (name, checksum) VALUES (?, ?)')

    for (const name of pending) {
      const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8')
      db.transaction(() => {
        db.exec(sql)
        record.run(name, checksum(sql))
      })()
    }

    return { applied: pending, alreadyApplied }
  } finally {
    db.close()
  }
}

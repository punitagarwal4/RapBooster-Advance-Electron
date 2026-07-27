/**
 * Prisma client singleton.
 *
 * CLAUDE.md §2.4: main is the sole database writer. wa-service asks main to
 * persist and never opens the file itself — one writer means no SQLite lock
 * contention, one place to enforce transactions, and one place to audit.
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'
import { PrismaClient } from '../../../generated/prisma/client'
import { databasePath, databaseUrl } from './paths'

let client: PrismaClient | undefined

/**
 * Pragmas are set on a short-lived raw connection because the adapter opens its
 * own. WAL and foreign_keys persist per-database and per-connection
 * respectively; setting them here guarantees a known state before the first
 * Prisma query runs.
 */
function applyPragmas(dbPath: string): void {
  const db = new Database(dbPath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    // NORMAL is the right trade-off with WAL: durable across app crashes,
    // only at risk in an OS-level power loss, and far faster than FULL for the
    // batched writes the campaign queue performs.
    db.pragma('synchronous = NORMAL')
  } finally {
    db.close()
  }
}

export function getPrisma(): PrismaClient {
  if (!client) {
    const path = databasePath()
    applyPragmas(path)
    client = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: databaseUrl() }),
    })
  }
  return client
}

export async function disconnectPrisma(): Promise<void> {
  if (!client) return
  const c = client
  client = undefined
  await c.$disconnect()
}

/**
 * Checkpoint the WAL into the main database file. Called on graceful shutdown
 * so the app does not leave a large -wal alongside the database, which slows the
 * next launch and confuses anyone inspecting or backing up the file.
 */
export function checkpoint(): void {
  const db = new Database(databasePath())
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

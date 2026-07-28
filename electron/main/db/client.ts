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
 * Set the pragmas that persist in the database file itself.
 *
 * `journal_mode` is stored in the file header, so setting it once on any
 * connection applies to every later one. The others are per-connection and
 * are handled by `applyConnectionPragmas` below.
 */
function applyFilePragmas(dbPath: string): void {
  const db = new Database(dbPath)
  try {
    db.pragma('journal_mode = WAL')
  } finally {
    db.close()
  }
}

/**
 * Set the per-connection pragmas on the connection Prisma actually uses.
 *
 * WHY this is separate: `foreign_keys`, `busy_timeout` and `synchronous` are
 * per-connection and reset to SQLite's defaults (OFF / 0 / FULL) on every new
 * connection. The driver adapter opens its own connection from the URL, and it
 * sets no pragmas of its own — verified by searching its dist bundle — so
 * configuring a separate short-lived connection, as this used to do, left
 * Prisma's real connection on the defaults.
 *
 * `busy_timeout = 0` was the concrete cost: a write colliding with the WAL
 * checkpoint or a backup fails instantly with SQLITE_BUSY instead of waiting,
 * which surfaces as a spurious "database is locked" during ordinary
 * multi-device sending.
 *
 * Cascade deletes were unaffected either way — Prisma's query compiler issues
 * those itself rather than relying on the database — which is why the packaged
 * self-test's cascade assertion passed throughout. `foreign_keys = ON` is still
 * correct as defence in depth for constraints Prisma does not emulate.
 */
async function applyConnectionPragmas(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000')
  // NORMAL is the right trade-off with WAL: durable across app crashes, only at
  // risk in an OS-level power loss, and far faster than FULL for the batched
  // writes the campaign queue performs.
  await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL')
}

/** Read back the pragmas that matter, so boot can prove they took effect. */
export async function verifyConnectionPragmas(): Promise<{
  foreignKeys: number
  busyTimeout: number
}> {
  const prisma = getPrisma()
  const [fk] =
    await prisma.$queryRawUnsafe<{ foreign_keys: number }[]>('PRAGMA foreign_keys')
  const [bt] = await prisma.$queryRawUnsafe<{ timeout: number }[]>('PRAGMA busy_timeout')
  return {
    foreignKeys: Number(fk?.foreign_keys ?? 0),
    busyTimeout: Number(bt?.timeout ?? 0),
  }
}

export function getPrisma(): PrismaClient {
  if (!client) {
    applyFilePragmas(databasePath())
    client = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: databaseUrl() }),
    })
    // Fire-and-forget is safe here: the adapter serialises statements on one
    // connection, so these are queued ahead of any query a caller issues next.
    // Boot asserts the result via verifyConnectionPragmas rather than trusting it.
    void applyConnectionPragmas(client).catch((err: unknown) => {
      console.error('could not apply connection pragmas', err)
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

/**
 * T1.1 — Prisma / Electron packaging spike.
 *
 * WHY: SPRINTS.md §9.1 requires proving that Prisma Client works inside a
 * packaged, asar-packed Electron build before any other Sprint 1 work starts.
 * The fallback (Drizzle on the same better-sqlite3 driver) is pre-agreed, so
 * this file exists to answer one question with evidence rather than opinion.
 *
 * It runs headless: no window, no renderer. It resolves the per-OS-user data
 * directory, applies migration SQL the way the real boot migrator will, then
 * writes and reads through Prisma and exits non-zero on any failure.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../generated/prisma/client'

const step = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/**
 * Mirrors the T1.4 boot migrator: apply any *.sql under prisma/migrations that
 * has not been recorded yet, tracking applied names in _migrations. The Prisma
 * CLI is deliberately not involved — it must not be required at runtime.
 */
function migrate(dbPath: string, migrationsDir: string): number {
  const db = new Database(dbPath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name       TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    )

    const applied = new Set(
      db.prepare('SELECT name FROM _migrations').all().map((r) => (r as { name: string }).name),
    )

    const pending = existsSync(migrationsDir)
      ? readdirSync(migrationsDir)
          .filter((d) => !applied.has(d))
          .filter((d) => existsSync(join(migrationsDir, d, 'migration.sql')))
          .sort()
      : []

    const record = db.prepare('INSERT INTO _migrations (name) VALUES (?)')
    for (const name of pending) {
      const sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8')
      db.transaction(() => {
        db.exec(sql)
        record.run(name)
      })()
    }
    return pending.length
  } finally {
    db.close()
  }
}

/**
 * Locate prisma/migrations across dev and packaged layouts.
 *
 * WHY the candidate list: app.getAppPath() is not reliable in dev — launching
 * `electron out/main/spike.js` makes it return out/main, not the repo root. In a
 * packaged build the migrations live inside app.asar. Probing an ordered list is
 * more robust than trusting any single anchor, and failing loudly beats silently
 * running against an unmigrated database.
 */
function resolveMigrationsDir(): string {
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
        join(__dirname, '..', '..', ...rel),
      ]
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!
}

async function main(): Promise<void> {
  const failures: string[] = []
  const check = (name: string, ok: boolean, detail = ''): void => {
    step(name, ok, detail)
    if (!ok) failures.push(name)
  }

  console.log('--- T1.1 Prisma/Electron packaging spike ---')
  console.log(`electron ${process.versions.electron} · node ${process.versions.node}`)
  console.log(`packaged: ${app.isPackaged}`)

  // 1. Per-OS-user data directory (SPRINTS.md §3.4)
  const userData = app.getPath('userData')
  mkdirSync(userData, { recursive: true })
  check('userData resolves', existsSync(userData), userData)

  const dbPath = join(userData, 'spike.db')
  const dbUrl = `file:${dbPath}`

  // 2. Migrations ship inside the asar in a packaged build.
  const migrationsDir = resolveMigrationsDir()
  check('migrations dir found', existsSync(migrationsDir), migrationsDir)

  // 3. Native module loads (this is what asar most often breaks)
  let appliedCount = -1
  try {
    appliedCount = migrate(dbPath, migrationsDir)
    check('better-sqlite3 loads + migrations apply', true, `${appliedCount} applied`)
  } catch (err) {
    check('better-sqlite3 loads + migrations apply', false, String(err))
  }

  // 4. Prisma Client through the better-sqlite3 driver adapter
  try {
    const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbUrl }) })
    const note = `spike-${Date.now()}`
    const created = await prisma.spikeProbe.create({ data: { note } })
    check('prisma write', created.note === note, `id=${created.id}`)

    const found = await prisma.spikeProbe.findFirst({ where: { note } })
    check('prisma read', found?.note === note)

    const total = await prisma.spikeProbe.count()
    check('prisma aggregate', total >= 1, `${total} rows`)

    await prisma.$disconnect()
    check('prisma disconnect', true)
  } catch (err) {
    check('prisma client round-trip', false, String(err))
  }

  // 5. Second migrate() must be a no-op — the boot migrator runs on every launch.
  try {
    const second = migrate(dbPath, migrationsDir)
    check('migrator is idempotent', second === 0, `${second} applied on rerun`)
  } catch (err) {
    check('migrator is idempotent', false, String(err))
  }

  console.log('---')
  if (failures.length > 0) {
    console.log(`SPIKE FAILED (${failures.length}): ${failures.join(', ')}`)
    app.exit(1)
    return
  }
  console.log('SPIKE PASSED — Prisma 7 + better-sqlite3 viable in Electron')
  app.exit(0)
}

// userData is derived from the app name, so set it before anything reads a path.
app.setName('RapBooster Advance')

app.whenReady().then(main).catch((err) => {
  console.error('SPIKE CRASHED', err)
  app.exit(1)
})

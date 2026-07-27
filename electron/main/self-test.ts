/**
 * Headless self-test (`--self-test`).
 *
 * Originally the T1.1 packaging spike; now the standing packaged-build probe
 * that scripts/smoke.mjs runs every sprint (SPRINTS.md §13.4). It deliberately
 * calls the *production* boot path and Prisma client rather than a private copy,
 * so a regression in the real code is what fails the smoke test.
 *
 * No window, no renderer. Exits non-zero on any failure.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { bootDatabase } from './db/boot'
import { checkpoint, disconnectPrisma, getPrisma } from './db/client'
import { backupsDir, databasePath, migrationsDir, userDataDir } from './db/paths'
import { listBackups } from './db/backup'

const failures: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

async function main(): Promise<void> {
  console.log('--- RapBooster self-test ---')
  console.log(`electron ${process.versions.electron} · node ${process.versions.node}`)
  console.log(`packaged: ${app.isPackaged}`)

  check('userData resolves', existsSync(userDataDir()), userDataDir())
  check('migrations dir found', existsSync(migrationsDir()), migrationsDir())

  // 1. Production boot path: integrity → backup → migrate.
  try {
    const report = await bootDatabase()
    check(
      'database boots (integrity/backup/migrate)',
      report.integrity.status !== 'corrupt',
      `integrity=${report.integrity.status} applied=${report.migrations.applied.length}`,
    )
    check('database file exists', existsSync(databasePath()), databasePath())
  } catch (err) {
    check('database boots (integrity/backup/migrate)', false, String(err))
  }

  // 2. Prisma round-trip through the real client singleton. Setting is a real
  //    production table, so this exercises the shipped schema.
  try {
    const prisma = getPrisma()
    const key = `selftest.${Date.now()}`

    await prisma.setting.create({ data: { key, value: 'ok' } })
    const found = await prisma.setting.findUnique({ where: { key } })
    check('prisma write + read', found?.value === 'ok')

    await prisma.setting.update({ where: { key }, data: { value: 'updated' } })
    const updated = await prisma.setting.findUnique({ where: { key } })
    check('prisma update', updated?.value === 'updated')

    await prisma.setting.delete({ where: { key } })
    const gone = await prisma.setting.findUnique({ where: { key } })
    check('prisma delete', gone === null)

    // Relations exercise foreign keys and the JSON-blob contact model.
    const list = await prisma.contactList.create({
      data: { name: `selftest-${Date.now()}`, fields: JSON.stringify(['Name', 'Mobile']) },
    })
    await prisma.contact.create({
      data: {
        listId: list.id,
        name: 'Self Test',
        phone: `+9199${Date.now().toString().slice(-8)}`,
        data: JSON.stringify({ Name: 'Self Test', Company: 'Probe' }),
      },
    })
    const withContacts = await prisma.contactList.findUnique({
      where: { id: list.id },
      include: { contacts: true },
    })
    check('prisma relations', withContacts?.contacts.length === 1)

    // Cascade delete proves foreign_keys is actually ON.
    await prisma.contactList.delete({ where: { id: list.id } })
    const orphans = await prisma.contact.count({ where: { listId: list.id } })
    check('cascade delete (foreign_keys ON)', orphans === 0)

    await disconnectPrisma()
    check('prisma disconnect', true)
  } catch (err) {
    check('prisma round-trip', false, String(err))
  }

  // 3. Re-running the boot path must be a no-op — it runs on every launch.
  try {
    const second = await bootDatabase()
    check(
      'boot is idempotent',
      second.migrations.applied.length === 0,
      `${second.migrations.applied.length} applied on rerun`,
    )
    check('backup written', listBackups(backupsDir()).length > 0)
  } catch (err) {
    check('boot is idempotent', false, String(err))
  }

  // 4. Clean shutdown leaves no oversized WAL behind.
  try {
    checkpoint()
    check('wal checkpoint', true)
  } catch (err) {
    check('wal checkpoint', false, String(err))
  }

  console.log('---')
  if (failures.length > 0) {
    console.log(`SELF-TEST FAILED (${failures.length}): ${failures.join(', ')}`)
    app.exit(1)
    return
  }
  console.log('SELF-TEST PASSED')
  app.exit(0)
}

app.whenReady()
  .then(main)
  .catch((err) => {
    console.error('SELF-TEST CRASHED', err)
    app.exit(1)
  })

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

  // 5. Baileys' image-thumbnail path must work *inside the packaged app*.
  //
  // This cannot be checked in dev: sharp is an optional peer dependency of
  // Baileys, so npm hoists it to the root and dev always finds it, while
  // electron-builder — which walks only our own production dependency graph —
  // used to omit it entirely. The result was image messages going out with no
  // thumbnail and no dimensions, silently, because Baileys logs that failure at
  // debug level and carries on. Only a packaged run proves sharp is both
  // shipped and loadable from outside the asar.
  try {
    const { extractImageThumb } = await import('baileys/lib/Utils/messages-media.js')
    // 8x8 solid-red PNG, inline so the probe needs nothing from disk.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1Jr' +
        'AAAAEUlEQVQI12O4IyeHFTEMLQkAid1GAWii5iMAAAAASUVORK5CYII=',
      'base64',
    )
    const { buffer, original } = await extractImageThumb(png, 32)
    // 0xFFD8 is the JPEG SOI marker — Baileys base64s this straight into the
    // message as jpegThumbnail, so it has to genuinely be a JPEG. Dimensions
    // are asserted too: they populate width/height on the outgoing message.
    check(
      'baileys image thumbnail',
      buffer.length > 0 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        original?.width === 8 &&
        original?.height === 8,
    )
  } catch (err) {
    check('baileys image thumbnail', false, String(err))
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

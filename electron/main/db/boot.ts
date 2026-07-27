/**
 * Database boot sequence: integrity check → backup → migrate.
 *
 * Order matters. Checking integrity first means a corrupt file is quarantined
 * before a migration can fail against it; backing up before migrating means a
 * forward-only migration that damages data is still recoverable.
 */
import { createBackup } from './backup'
import { checkIntegrity, quarantine, type IntegrityReport } from './integrity'
import { runMigrations, type MigrationResult } from './migrator'
import { backupsDir, databasePath, migrationsDir } from './paths'

export interface DbBootReport {
  integrity: IntegrityReport
  backupPath: string | null
  migrations: MigrationResult
  recovered: boolean
}

export async function bootDatabase(): Promise<DbBootReport> {
  const dbPath = databasePath()

  const integrity = checkIntegrity(dbPath)
  let recovered = false
  if (integrity.status === 'corrupt') {
    integrity.quarantinedTo = quarantine(dbPath)
    recovered = true
  }

  // Nothing to back up on a first run or straight after quarantine.
  const backupPath = recovered ? null : await createBackup(dbPath, backupsDir(), 'premigrate')

  const migrations = runMigrations(dbPath, migrationsDir())

  return { integrity, backupPath, migrations, recovered }
}

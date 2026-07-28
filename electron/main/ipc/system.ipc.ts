/**
 * System channels — version, paths, dashboard, and opening a folder.
 *
 * These are the first real handlers, so they also prove the contract end to end:
 * request validation, response validation, and the error envelope.
 */
import { app, shell } from 'electron'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { AppError } from '../../../shared/errors'
import { createBackup } from '../db/backup'
import { checkpoint, disconnectPrisma, getPrisma } from '../db/client'
import { checkIntegrity } from '../db/integrity'
import { backupsDir, databasePath, logsDir, userDataDir } from '../db/paths'
import { buildDiagnostics } from '../services/diagnostics'
import { waBridge } from '../wa-bridge'
import { registerHandler } from './router'

export function registerSystemHandlers(): void {
  registerHandler('system:version', () => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    platform: `${process.platform}-${process.arch}`,
  }))

  registerHandler('system:paths', () => ({
    userData: userDataDir(),
    database: databasePath(),
    logs: logsDir(),
  }))

  registerHandler('system:openPath', async ({ path }) => {
    // Only paths inside our own data directory may be opened. Without this the
    // renderer could ask the OS to open anything on disk.
    const root = userDataDir()
    if (!path.startsWith(root)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'That location cannot be opened.',
        detail: `openPath outside userData: ${path}`,
      })
    }
    const error = await shell.openPath(path)
    if (error) {
      throw new AppError('UNKNOWN', { detail: `shell.openPath: ${error}` })
    }
    return { ok: true as const }
  })

  registerHandler('system:exportDiagnostics', async () => ({
    filePath: await buildDiagnostics(),
  }))

  registerHandler('system:waServiceState', () => ({
    state: waBridge.currentState(),
    restartCount: waBridge.restartCount(),
  }))

  registerHandler('system:backup', async () => {
    // Flush the WAL first, or the snapshot can miss recently committed writes.
    checkpoint()
    const filePath = await createBackup(databasePath(), backupsDir(), 'manual')
    if (!filePath) {
      throw new AppError('DB_ERROR', { userMessage: 'There is no database to back up yet.' })
    }
    return { filePath }
  })

  registerHandler('system:restore', async ({ filePath }) => {
    if (!existsSync(filePath)) {
      throw new AppError('NOT_FOUND', { userMessage: 'That backup file no longer exists.' })
    }

    // Verify before destroying anything: restoring a corrupt file over a
    // working database would turn a recoverable situation into data loss.
    const check = checkIntegrity(filePath)
    if (check.status === 'corrupt') {
      throw new AppError('INTEGRITY_FAILED', {
        userMessage: 'That backup failed its integrity check and was not restored.',
        detail: check.detail ?? '',
      })
    }

    // Snapshot what is there now, so a restore is itself undoable.
    await createBackup(databasePath(), backupsDir(), 'pre-restore')

    await disconnectPrisma()
    checkpoint()

    copyFileSync(filePath, databasePath())
    // Stale sidecars belong to the replaced database.
    for (const suffix of ['-wal', '-shm']) {
      rmSync(databasePath() + suffix, { force: true })
    }

    // The app must restart: every open handle and cached row now refers to a
    // database that no longer exists.
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 500)

    return { ok: true as const }
  })

  registerHandler('system:clearData', async ({ confirmation }) => {
    // The literal is enforced by the contract too; this is the second lock on
    // an action with no undo.
    if (confirmation !== 'DELETE') {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Type DELETE to confirm.',
      })
    }

    // A backup first, so "clear everything" is still recoverable by someone
    // who meant something narrower.
    await createBackup(databasePath(), backupsDir(), 'pre-clear')

    const prisma = getPrisma()
    // Order matters: children before parents, since foreign keys are enforced.
    await prisma.$transaction([
      prisma.campaignRecipient.deleteMany(),
      prisma.campaignDevice.deleteMany(),
      prisma.campaignList.deleteMany(),
      prisma.campaign.deleteMany(),
      prisma.groupSendTarget.deleteMany(),
      prisma.groupSendJob.deleteMany(),
      prisma.groupCreateJob.deleteMany(),
      prisma.group.deleteMany(),
      prisma.message.deleteMany(),
      prisma.chat.deleteMany(),
      prisma.contact.deleteMany(),
      prisma.contactList.deleteMany(),
      prisma.template.deleteMany(),
    ])

    return { ok: true as const }
  })

  registerHandler('system:dashboard', async () => {
    const prisma = getPrisma()
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    // Aggregated in SQL rather than by loading rows — this screen must stay
    // fast at 50k contacts (CLAUDE.md §5.7).
    const [totalContacts, activeDevices, runningCampaigns, templates, sentToday, failedToday] =
      await Promise.all([
        prisma.contact.count(),
        prisma.device.count({ where: { status: 'connected' } }),
        prisma.campaign.count({ where: { status: { in: ['running', 'paused'] } } }),
        prisma.template.count(),
        prisma.campaignRecipient.count({
          where: { status: 'sent', sentAt: { gte: startOfDay } },
        }),
        prisma.campaignRecipient.count({
          where: { status: 'failed', sentAt: { gte: startOfDay } },
        }),
      ])

    return { totalContacts, activeDevices, runningCampaigns, templates, sentToday, failedToday }
  })
}

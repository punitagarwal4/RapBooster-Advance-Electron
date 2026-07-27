/**
 * System channels — version, paths, dashboard, and opening a folder.
 *
 * These are the first real handlers, so they also prove the contract end to end:
 * request validation, response validation, and the error envelope.
 */
import { app, shell } from 'electron'
import { AppError } from '../../../shared/errors'
import { getPrisma } from '../db/client'
import { databasePath, logsDir, userDataDir } from '../db/paths'
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

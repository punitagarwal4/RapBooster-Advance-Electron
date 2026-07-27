import { AppError } from '../../../shared/errors'
import { getPrisma } from '../db/client'
import { groupRunner } from '../services/group-runner'
import { registerHandler } from './router'

export function registerGroupHandlers(): void {
  registerHandler('group:list', async ({ deviceId }) => {
    const rows = await getPrisma().group.findMany({
      where: deviceId ? { deviceId } : {},
      orderBy: { name: 'asc' },
    })
    return rows.map((g) => ({
      id: g.id,
      deviceId: g.deviceId,
      name: g.name,
      memberCount: g.memberCount,
      isAdmin: g.isAdmin,
      syncedAt: g.syncedAt.toISOString(),
    }))
  })

  registerHandler('group:sync', async ({ deviceId }) => ({
    synced: await groupRunner.sync(deviceId),
  }))

  registerHandler('groupSend:create', async ({ templateId, groupIds, delaySeconds }) => {
    if (groupIds.length === 0) {
      // Mirrors the prototype's validation wording.
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Select at least one group',
      })
    }

    if (templateId.trim() === '') {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Select a template' })
    }
    const template = await getPrisma().template.findUnique({ where: { id: templateId } })
    if (!template) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Select a template' })
    }

    return { jobId: await groupRunner.startSend(templateId, groupIds, delaySeconds) }
  })

  registerHandler('groupSend:status', async ({ jobId }) => {
    const job = await getPrisma().groupSendJob.findUnique({ where: { id: jobId } })
    if (!job) throw new AppError('NOT_FOUND', { userMessage: 'That job no longer exists.' })
    return {
      status: job.status as 'pending' | 'running' | 'paused' | 'completed' | 'failed',
      total: job.totalCount,
      sent: job.sentCount,
      failed: job.failedCount,
    }
  })

  registerHandler('groupCreate:create', async (input) => {
    const device = await getPrisma().device.findUnique({ where: { id: input.deviceId } })
    if (!device) throw new AppError('NOT_FOUND', { userMessage: 'That device no longer exists.' })
    if (device.status !== 'connected') {
      throw new AppError('DEVICE_NOT_CONNECTED', {
        userMessage: 'Connect that device before creating groups.',
      })
    }

    return { jobId: await groupRunner.startCreate(input) }
  })

  registerHandler('groupCreate:status', async ({ jobId }) => {
    const job = await getPrisma().groupCreateJob.findUnique({ where: { id: jobId } })
    if (!job) throw new AppError('NOT_FOUND', { userMessage: 'That job no longer exists.' })
    return {
      status: job.status as 'pending' | 'running' | 'paused' | 'completed' | 'failed',
      created: job.createdCount,
      failed: job.failedCount,
      resultLog: job.resultLog,
    }
  })
}

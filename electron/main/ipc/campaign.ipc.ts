/**
 * Campaign channels.
 *
 * Counters returned here always come from `CampaignRecipient` rows rather than
 * the denormalized columns, so the UI cannot show a stale total after a crash.
 */
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '../../../shared/errors'
import { getPrisma } from '../db/client'
import { userDataDir } from '../db/paths'
import { campaignEngine, counters } from '../services/campaign-engine'
import { toCsvValue as csv } from '../services/csv'
import { registerHandler } from './router'

async function serialize(id: string) {
  const campaign = await getPrisma().campaign.findUnique({
    where: { id },
    include: { devices: true, lists: true, template: true },
  })
  if (!campaign)
    throw new AppError('NOT_FOUND', { userMessage: 'That campaign no longer exists.' })

  const c = await counters(id)

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status as
      'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed',
    templateId: campaign.templateId,
    templateName: campaign.template.name,
    deviceIds: campaign.devices.map((d) => d.deviceId),
    listIds: campaign.lists.map((l) => l.listId),
    scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
    delayFrom: campaign.delayFrom,
    delayTo: campaign.delayTo,
    sleepDuration: campaign.sleepDuration,
    sleepAfter: campaign.sleepAfter,
    totalCount: c.total || campaign.totalCount,
    sentCount: c.sent,
    failedCount: c.failed,
    createdAt: campaign.createdAt.toISOString(),
  }
}

export function registerCampaignHandlers(): void {
  registerHandler('campaign:list', async () => {
    const rows = await getPrisma().campaign.findMany({ orderBy: { createdAt: 'desc' } })
    return Promise.all(rows.map((r) => serialize(r.id)))
  })

  registerHandler('campaign:get', async ({ id }) => serialize(id))

  registerHandler('campaign:create', async (input) => {
    const name = input.name.trim()
    if (name === '') {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Fill all required fields' })
    }

    // Mirrors the prototype's validation message.
    if (input.deviceIds.length === 0 || input.listIds.length === 0) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Select at least one device and contact list',
      })
    }

    const template = await getPrisma().template.findUnique({
      where: { id: input.templateId },
    })
    if (!template) {
      throw new AppError('NOT_FOUND', { userMessage: 'That template no longer exists.' })
    }

    const created = await getPrisma().campaign.create({
      data: {
        name,
        templateId: input.templateId,
        status: input.scheduledAt ? 'scheduled' : 'draft',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        delayFrom: input.delayFrom,
        delayTo: input.delayTo,
        sleepDuration: input.sleepDuration,
        sleepAfter: input.sleepAfter,
        devices: { create: input.deviceIds.map((deviceId) => ({ deviceId })) },
        lists: { create: input.listIds.map((listId) => ({ listId })) },
      },
    })

    return serialize(created.id)
  })

  registerHandler('campaign:start', async ({ id }) => {
    await campaignEngine.start(id)
    return { ok: true as const }
  })

  registerHandler('campaign:pause', async ({ id }) => {
    await campaignEngine.pause(id)
    return { ok: true as const }
  })

  registerHandler('campaign:resume', async ({ id }) => {
    await campaignEngine.start(id)
    return { ok: true as const }
  })

  registerHandler('campaign:stop', async ({ id }) => {
    await campaignEngine.stop(id)
    return { ok: true as const }
  })

  registerHandler('campaign:delete', async ({ id }) => {
    // Stopping first prevents a worker from writing rows back after deletion.
    await campaignEngine.stop(id).catch(() => {
      // A campaign that was never started has nothing to stop.
    })
    await getPrisma().campaign.delete({ where: { id } })
    return { ok: true as const }
  })

  registerHandler('campaign:report', async ({ id }) => {
    const campaign = await getPrisma().campaign.findUnique({
      where: { id },
      include: { template: true },
    })
    if (!campaign) {
      throw new AppError('NOT_FOUND', { userMessage: 'That campaign no longer exists.' })
    }

    const exportsDir = join(userDataDir(), 'exports')
    mkdirSync(exportsDir, { recursive: true })
    const filePath = join(
      exportsDir,
      `${campaign.name.replace(/[^\w\-. ]+/g, '_')}-report-${Date.now()}.csv`,
    )

    const c = await counters(id)

    // One row per recipient (REQUIREMENTS §7.2, assumption A9) rather than the
    // prototype's plain-text summary: a summary cannot tell the user *which*
    // numbers failed, which is the only actionable part of a report.
    const stream = createWriteStream(filePath, { encoding: 'utf8' })
    let rows = 0

    try {
      stream.write(`# Campaign,${csv(campaign.name)}\n`)
      stream.write(`# Status,${csv(campaign.status)}\n`)
      stream.write(`# Template,${csv(campaign.template.name)}\n`)
      stream.write(`# Total,${c.total}\n`)
      stream.write(`# Sent,${c.sent}\n`)
      stream.write(`# Failed,${c.failed}\n`)
      stream.write(`# Generated,${new Date().toISOString()}\n`)
      stream.write('phone,name,device,status,attempts,sentAt,error\n')

      let cursor: string | undefined
      for (;;) {
        const page = await getPrisma().campaignRecipient.findMany({
          where: { campaignId: id },
          orderBy: { id: 'asc' },
          take: 1_001,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            contact: { select: { name: true } },
            device: { select: { name: true } },
          },
        })
        if (page.length === 0) break

        const hasMore = page.length > 1_000
        const slice = hasMore ? page.slice(0, 1_000) : page

        for (const r of slice) {
          stream.write(
            [
              csv(r.phone),
              csv(r.contact?.name ?? ''),
              csv(r.device?.name ?? ''),
              csv(r.status),
              String(r.attempts),
              csv(r.sentAt?.toISOString() ?? ''),
              csv(r.error ?? ''),
            ].join(',') + '\n',
          )
          rows += 1
        }

        if (!hasMore) break
        cursor = slice[slice.length - 1]?.id
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        stream.on('error', reject)
        stream.on('finish', () => resolve())
        stream.end()
      })
    }

    return { filePath, rows }
  })

  registerHandler('campaign:recipients', async ({ id, status, cursor, limit }) => {
    const where = { campaignId: id, ...(status ? { status } : {}) }

    const [rows, total] = await Promise.all([
      getPrisma().campaignRecipient.findMany({
        where,
        orderBy: { id: 'asc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { contact: { select: { name: true } } },
      }),
      getPrisma().campaignRecipient.count({ where }),
    ])

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return {
      items: page.map((r) => ({
        id: r.id,
        phone: r.phone,
        contactName: r.contact?.name ?? '',
        deviceId: r.deviceId,
        status: r.status as 'pending' | 'sending' | 'sent' | 'failed' | 'skipped',
        attempts: r.attempts,
        error: r.error,
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      total,
    }
  })
}

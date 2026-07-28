/**
 * Campaign send engine (SPRINTS.md §6.2–§6.4).
 *
 * Runs in main because it owns the database. Pacing is enforced in wa-service
 * at the socket boundary, so this file never sleeps between sends — it asks
 * wa-service to send and the scheduler there decides when.
 *
 * The correctness rules, in order of importance:
 *
 *   1. Progress lives in `CampaignRecipient` rows, never in memory. A crash
 *      must lose nothing that was already decided.
 *   2. A row is claimed with a single atomic UPDATE, so two workers can never
 *      take the same recipient.
 *   3. Counters are recomputed from rows, never incremented in memory, so they
 *      cannot drift after a restart.
 */
import Database from 'better-sqlite3'
import { getPrisma } from '../db/client'
import { databasePath } from '../db/paths'
import { renderTemplate } from '../../../shared/merge-tags'
import type { WaOutgoing } from '../../../shared/wa-protocol'
import { waBridge } from '../wa-bridge'

export interface CampaignCounters {
  total: number
  sent: number
  failed: number
  pending: number
}

/** Retryable failures are transient; terminal ones will fail identically forever. */
function isRetryable(message: string): boolean {
  const terminal = [
    'not on whatsapp',
    'invalid number',
    'blocked',
    'forbidden',
    'not-authorized',
  ]
  const lower = message.toLowerCase()
  return !terminal.some((t) => lower.includes(t))
}

/**
 * Claim the next pending recipient for a device.
 *
 * Deliberately raw SQL: this must be one statement so SQLite's write lock makes
 * it atomic. Prisma would issue a SELECT then an UPDATE, leaving a window in
 * which two workers could claim the same row and send twice.
 */
export function claimNext(campaignId: string, deviceId: string): {
  id: string
  contactId: string
  phone: string
  attempts: number
} | null {
  const db = new Database(databasePath())
  try {
    db.pragma('busy_timeout = 5000')
    const row = db
      .prepare(
        `UPDATE CampaignRecipient
            SET status = 'sending', claimedAt = CURRENT_TIMESTAMP
          WHERE id = (
            SELECT id FROM CampaignRecipient
             WHERE campaignId = ? AND deviceId = ? AND status = 'pending'
             ORDER BY rowid
             LIMIT 1
          )
        RETURNING id, contactId, phone, attempts`,
      )
      .get(campaignId, deviceId) as
      | { id: string; contactId: string; phone: string; attempts: number }
      | undefined
    return row ?? null
  } finally {
    db.close()
  }
}

export async function counters(campaignId: string): Promise<CampaignCounters> {
  const grouped = await getPrisma().campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  })

  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]))
  const sent = byStatus.get('sent') ?? 0
  const failed = byStatus.get('failed') ?? 0
  const skipped = byStatus.get('skipped') ?? 0
  const pending = (byStatus.get('pending') ?? 0) + (byStatus.get('sending') ?? 0)

  return { total: sent + failed + skipped + pending, sent, failed, pending }
}

/** Build the wire payload for one recipient, resolving merge tags. */
function buildMessage(
  template: {
    type: string
    content: string
    mediaType: string | null
    mediaPath: string | null
    buttons: string | null
  },
  values: Record<string, string>,
): WaOutgoing {
  const { text } = renderTemplate(template.content, values)

  if (template.type === 'media' && template.mediaPath) {
    return {
      kind: 'media',
      path: template.mediaPath,
      mediaType: (template.mediaType as 'image' | 'video') ?? 'image',
      ...(text ? { caption: text } : {}),
    }
  }

  if (template.type === 'button' && template.buttons) {
    try {
      const parsed: unknown = JSON.parse(template.buttons)
      if (Array.isArray(parsed)) {
        return {
          kind: 'buttons',
          body: text,
          buttons: parsed.filter((b): b is string => typeof b === 'string'),
        }
      }
    } catch {
      // Fall through to plain text — a corrupt button list must not stop a send.
    }
  }

  return { kind: 'text', body: text }
}

type ProgressListener = (campaignId: string, counters: CampaignCounters) => void

export class CampaignEngine {
  private readonly running = new Map<string, AbortController>()
  private progress: ProgressListener | undefined

  onProgress(listener: ProgressListener): void {
    this.progress = listener
  }

  isRunning(campaignId: string): boolean {
    return this.running.has(campaignId)
  }

  /**
   * Expand a campaign's lists into queue rows.
   *
   * Batched and de-duplicated: a contact appearing in two selected lists must
   * be queued once, which the unique(campaignId, contactId) constraint also
   * enforces at the database level.
   */
  async expand(campaignId: string): Promise<number> {
    const prisma = getPrisma()

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { devices: true, lists: true },
    })
    if (!campaign) throw new Error(`campaign ${campaignId} not found`)

    const deviceIds = campaign.devices.map((d) => d.deviceId)
    if (deviceIds.length === 0) throw new Error('campaign has no devices')

    const existing = await prisma.campaignRecipient.count({ where: { campaignId } })
    if (existing > 0) return existing

    const listIds = campaign.lists.map((l) => l.listId)
    let created = 0
    let cursor: string | undefined
    let index = 0

    for (;;) {
      const contacts = await prisma.contact.findMany({
        where: { listId: { in: listIds }, isValid: true },
        orderBy: { id: 'asc' },
        take: 1_000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (contacts.length === 0) break

      // Round-robin across devices so no single account carries the run.
      const rows = contacts.map((contact) => ({
        campaignId,
        contactId: contact.id,
        deviceId: deviceIds[index++ % deviceIds.length]!,
        phone: contact.phone,
      }))

      const seen = new Set<string>()
      const deduped = rows.filter((r) => {
        if (seen.has(r.contactId)) return false
        seen.add(r.contactId)
        return true
      })

      const result = await prisma.campaignRecipient.createMany({ data: deduped })
      created += result.count
      cursor = contacts[contacts.length - 1]?.id
    }

    await prisma.campaign.update({ where: { id: campaignId }, data: { totalCount: created } })
    return created
  }

  async start(campaignId: string): Promise<void> {
    if (this.running.has(campaignId)) return

    const prisma = getPrisma()
    await this.expand(campaignId)

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { devices: true, template: true },
    })
    if (!campaign) throw new Error(`campaign ${campaignId} not found`)

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'running', startedAt: campaign.startedAt ?? new Date() },
    })

    // Pacing is per device and comes from the campaign, so configure the
    // scheduler before any worker starts.
    for (const link of campaign.devices) {
      const device = await prisma.device.findUnique({ where: { id: link.deviceId } })
      await waBridge
        .request('throttle:configure', {
          deviceId: link.deviceId,
          delayFromMs: campaign.delayFrom * 1_000,
          delayToMs: campaign.delayTo * 1_000,
          sleepDurationMs: campaign.sleepDuration * 1_000,
          sleepAfter: campaign.sleepAfter,
          ...(device ? { sentToday: device.dailySentCount } : {}),
        })
        .catch((err: unknown) => console.error('throttle:configure failed', err))
    }

    const controller = new AbortController()
    this.running.set(campaignId, controller)

    // One worker per device, running concurrently. Pacing inside wa-service
    // keeps each individual account sequential.
    const workers = campaign.devices.map((link) =>
      this.work(campaignId, link.deviceId, campaign.retryAttempts, controller.signal),
    )

    void Promise.all(workers)
      .then(() => this.finish(campaignId))
      .catch((err: unknown) => {
        console.error(`campaign ${campaignId} worker failed`, err)
        return this.finish(campaignId)
      })
  }

  private async work(
    campaignId: string,
    deviceId: string,
    retryAttempts: number,
    signal: AbortSignal,
  ): Promise<void> {
    const prisma = getPrisma()
    let sinceEmit = 0

    while (!signal.aborted) {
      const claimed = claimNext(campaignId, deviceId)
      if (!claimed) return

      const [contact, campaign] = await Promise.all([
        prisma.contact.findUnique({ where: { id: claimed.contactId } }),
        prisma.campaign.findUnique({ where: { id: campaignId }, include: { template: true } }),
      ])
      if (!campaign) return

      let values: Record<string, string> = {}
      if (contact) {
        try {
          const parsed: unknown = JSON.parse(contact.data)
          if (parsed && typeof parsed === 'object') {
            values = Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v ?? ''),
              ]),
            )
          }
        } catch {
          values = { Name: contact.name, Mobile: contact.phone }
        }
      }

      try {
        const { messageId } = await waBridge.request('message:send', {
          deviceId,
          to: claimed.phone,
          message: buildMessage(campaign.template, values),
        })

        await prisma.campaignRecipient.update({
          where: { id: claimed.id },
          data: { status: 'sent', messageId, sentAt: new Date(), error: null },
        })
        await prisma.device.update({
          where: { id: deviceId },
          data: { dailySentCount: { increment: 1 } },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const attempts = claimed.attempts + 1
        const canRetry = attempts <= retryAttempts && isRetryable(message)

        await prisma.campaignRecipient.update({
          where: { id: claimed.id },
          data: {
            // Back to pending so another pass picks it up; the attempt counter
            // is what stops it looping forever.
            status: canRetry ? 'pending' : 'failed',
            attempts,
            error: message,
            ...(canRetry ? {} : { sentAt: new Date() }),
          },
        })

        if (message.includes('daily cap')) {
          // The device is parked until tomorrow; this worker has nothing left
          // to do, and leaving the row pending is correct.
          return
        }
      }

      // Batched so a 100k-recipient run cannot flood the renderer.
      sinceEmit += 1
      if (sinceEmit >= 25) {
        sinceEmit = 0
        void this.emit(campaignId)
      }
    }
  }

  private async emit(campaignId: string): Promise<void> {
    const c = await counters(campaignId)
    await getPrisma().campaign.update({
      where: { id: campaignId },
      data: { sentCount: c.sent, failedCount: c.failed, totalCount: c.total },
    })
    this.progress?.(campaignId, c)
  }

  private async finish(campaignId: string): Promise<void> {
    this.running.delete(campaignId)
    const c = await counters(campaignId)

    const current = await getPrisma().campaign.findUnique({ where: { id: campaignId } })
    // Pause and stop set their own status; only a genuinely drained queue
    // completes.
    const status = current?.status === 'running' && c.pending === 0 ? 'completed' : current?.status

    await getPrisma().campaign.update({
      where: { id: campaignId },
      data: {
        sentCount: c.sent,
        failedCount: c.failed,
        totalCount: c.total,
        ...(status ? { status } : {}),
        ...(status === 'completed' ? { completedAt: new Date() } : {}),
      },
    })
    this.progress?.(campaignId, c)
  }

  async pause(campaignId: string): Promise<void> {
    this.running.get(campaignId)?.abort()
    this.running.delete(campaignId)
    await getPrisma().campaign.update({ where: { id: campaignId }, data: { status: 'paused' } })
    // A message already claimed but not yet answered would otherwise stay
    // 'sending' forever.
    await this.releaseClaimed(campaignId)
    await this.emit(campaignId)
  }

  async stop(campaignId: string): Promise<void> {
    this.running.get(campaignId)?.abort()
    this.running.delete(campaignId)
    await this.releaseClaimed(campaignId)
    await getPrisma().campaign.update({
      where: { id: campaignId },
      data: { status: 'completed', completedAt: new Date() },
    })
    await this.emit(campaignId)
  }

  /** Return in-flight claims to the queue. */
  private async releaseClaimed(campaignId: string): Promise<void> {
    await getPrisma().campaignRecipient.updateMany({
      where: { campaignId, status: 'sending' },
      data: { status: 'pending', claimedAt: null },
    })
  }

  /**
   * Crash recovery (SPRINTS.md §6.4). Runs before any worker starts.
   *
   * Anything claimed when the process died is returned to the queue. A message
   * that WhatsApp accepted but whose acknowledgement was never recorded will be
   * sent twice — bounded at one per device per crash, and documented in
   * SPRINTS §6.4 as accepted, because WhatsApp offers no deduplication
   * primitive that would let us do better.
   */
  async recover(): Promise<{ requeued: number; resumed: string[] }> {
    const prisma = getPrisma()

    const requeued = await prisma.campaignRecipient.updateMany({
      where: { status: 'sending' },
      data: { status: 'pending', claimedAt: null },
    })

    const running = await prisma.campaign.findMany({ where: { status: 'running' } })
    for (const campaign of running) {
      const c = await counters(campaign.id)
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { sentCount: c.sent, failedCount: c.failed, totalCount: c.total },
      })
    }

    // Scheduled campaigns whose time passed while the app was closed.
    const due = await prisma.campaign.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
    })

    const resumed: string[] = []
    for (const campaign of [...running, ...due]) {
      try {
        await this.start(campaign.id)
        resumed.push(campaign.id)
      } catch (err) {
        console.error(`recovery: could not resume campaign ${campaign.id}`, err)
      }
    }

    return { requeued: requeued.count, resumed }
  }

  /**
   * Move a disconnected device's pending recipients to devices that are still
   * connected (SPRINTS.md §11.1 T3.4).
   *
   * Without this, one dropped account strands its whole slice of the queue
   * until it reconnects — a 10k campaign with five devices would silently stall
   * at 80% and look finished. Only `pending` rows move: anything already sent
   * or in flight belongs to the device that handled it.
   *
   * If no device remains, the campaign pauses with a reason rather than
   * spinning against sockets that cannot send.
   */
  async reassignFrom(deviceId: string): Promise<{ moved: number; paused: string[] }> {
    const prisma = getPrisma()

    const affected = await prisma.campaign.findMany({
      where: { status: 'running', devices: { some: { deviceId } } },
      include: { devices: true },
    })

    let moved = 0
    const paused: string[] = []

    for (const campaign of affected) {
      const others = await prisma.device.findMany({
        where: {
          id: { in: campaign.devices.map((d) => d.deviceId), not: deviceId },
          status: 'connected',
        },
      })

      const pending = await prisma.campaignRecipient.count({
        where: { campaignId: campaign.id, deviceId, status: 'pending' },
      })
      if (pending === 0) continue

      if (others.length === 0) {
        await this.pause(campaign.id)
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { lastError: 'Paused: no connected device is available to send.' },
        })
        paused.push(campaign.id)
        continue
      }

      // Spread the orphaned rows evenly rather than dumping them on one device.
      const rows = await prisma.campaignRecipient.findMany({
        where: { campaignId: campaign.id, deviceId, status: 'pending' },
        select: { id: true },
      })

      await prisma.$transaction(
        rows.map((row, i) =>
          prisma.campaignRecipient.update({
            where: { id: row.id },
            data: { deviceId: others[i % others.length]!.id },
          }),
        ),
      )
      moved += rows.length
    }

    return { moved, paused }
  }

  /**
   * Start any scheduled campaign whose time has arrived.
   *
   * Compares against the wall clock rather than a monotonic timer, so a laptop
   * that slept through a scheduled time still fires on wake instead of silently
   * skipping it.
   */
  async runScheduled(): Promise<string[]> {
    const due = await getPrisma().campaign.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
    })

    const started: string[] = []
    for (const campaign of due) {
      if (this.running.has(campaign.id)) continue
      try {
        await this.start(campaign.id)
        started.push(campaign.id)
      } catch (err) {
        console.error(`scheduler: could not start campaign ${campaign.id}`, err)
        await getPrisma().campaign.update({
          where: { id: campaign.id },
          data: { status: 'failed', lastError: String(err) },
        })
      }
    }
    return started
  }

  async shutdown(): Promise<void> {
    for (const controller of this.running.values()) controller.abort()
    this.running.clear()
  }
}

export const campaignEngine = new CampaignEngine()

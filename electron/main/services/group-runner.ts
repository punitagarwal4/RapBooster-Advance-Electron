/**
 * Group jobs: bulk messaging and bulk creation (SPRINTS.md §11.1 T3.8–T3.9).
 *
 * Both run as database-backed jobs with per-target rows rather than in-memory
 * loops, for the same reason campaigns do: a job that cannot be observed or
 * resumed is one the user has to guess about after a crash.
 *
 * Sending goes through wa-service, so the throttle applies here exactly as it
 * does to campaigns — a bulk group send is still WhatsApp traffic from the
 * user's account.
 */
import { getPrisma } from '../db/client'
import { groupName } from '../../../shared/group-names'
import { renderTemplate } from '../../../shared/merge-tags'
import type { SuffixRule } from '../../../shared/types'
import { waBridge } from '../wa-bridge'

export interface GroupJobProgress {
  jobId: string
  kind: 'send' | 'create'
  done: number
  total: number
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
}

type ProgressListener = (progress: GroupJobProgress) => void

export class GroupRunner {
  private progress: ProgressListener | undefined
  private readonly active = new Set<string>()

  onProgress(listener: ProgressListener): void {
    this.progress = listener
  }

  isRunning(jobId: string): boolean {
    return this.active.has(jobId)
  }

  /** Refresh the local group cache for one device, or all connected devices. */
  async sync(deviceId?: string): Promise<number> {
    const prisma = getPrisma()

    const devices = await prisma.device.findMany({
      where: { status: 'connected', ...(deviceId ? { id: deviceId } : {}) },
    })

    let synced = 0
    for (const device of devices) {
      try {
        const { groups } = await waBridge.request('group:fetch', { deviceId: device.id })

        for (const group of groups) {
          await prisma.group.upsert({
            where: { id: group.id },
            create: {
              id: group.id,
              deviceId: device.id,
              name: group.name,
              memberCount: group.memberCount,
              isAdmin: group.isAdmin,
            },
            update: {
              name: group.name,
              memberCount: group.memberCount,
              isAdmin: group.isAdmin,
              syncedAt: new Date(),
            },
          })
          synced += 1
        }
      } catch (err) {
        // One unreachable device must not abandon the others.
        console.error(`group sync failed for device ${device.id}`, err)
      }
    }
    return synced
  }

  /** Queue a bulk send and start it. */
  async startSend(
    templateId: string,
    groupIds: string[],
    delaySeconds: number,
  ): Promise<string> {
    const prisma = getPrisma()

    const job = await prisma.groupSendJob.create({
      data: {
        templateId,
        delaySeconds,
        status: 'running',
        totalCount: groupIds.length,
        targets: { create: groupIds.map((groupId) => ({ groupId })) },
      },
    })

    void this.runSend(job.id).catch((err: unknown) => {
      console.error(`group send job ${job.id} failed`, err)
    })

    return job.id
  }

  private async runSend(jobId: string): Promise<void> {
    const prisma = getPrisma()
    this.active.add(jobId)

    try {
      const job = await prisma.groupSendJob.findUnique({
        where: { id: jobId },
        include: { template: true, targets: { include: { group: true } } },
      })
      if (!job) return

      const { text } = renderTemplate(job.template.content, {})
      let done = 0

      for (const target of job.targets) {
        if (!target.group) continue

        try {
          // The throttle in wa-service still applies; delaySeconds is the
          // additional per-group gap the prototype exposes.
          await waBridge.request('message:send', {
            deviceId: target.group.deviceId,
            to: target.group.id,
            message: { kind: 'text', body: text },
          })
          await prisma.groupSendTarget.update({
            where: { id: target.id },
            data: { status: 'sent', sentAt: new Date(), error: null },
          })
          await prisma.groupSendJob.update({
            where: { id: jobId },
            data: { sentCount: { increment: 1 } },
          })
        } catch (err) {
          await prisma.groupSendTarget.update({
            where: { id: target.id },
            data: {
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
            },
          })
          await prisma.groupSendJob.update({
            where: { id: jobId },
            data: { failedCount: { increment: 1 } },
          })
        }

        done += 1
        this.progress?.({
          jobId,
          kind: 'send',
          done,
          total: job.targets.length,
          status: 'running',
        })

        if (job.delaySeconds > 0 && done < job.targets.length) {
          await new Promise((r) => setTimeout(r, job.delaySeconds * 1_000))
        }
      }

      await prisma.groupSendJob.update({
        where: { id: jobId },
        data: { status: 'completed', completedAt: new Date() },
      })
      this.progress?.({
        jobId,
        kind: 'send',
        done,
        total: job.targets.length,
        status: 'completed',
      })
    } finally {
      this.active.delete(jobId)
    }
  }

  /** Queue a bulk group creation and start it. */
  async startCreate(input: {
    deviceId: string
    prefix: string
    suffixRule: SuffixRule
    count: number
    delaySeconds: number
    listIds: string[]
    contactsPerGroup: number
  }): Promise<string> {
    const job = await getPrisma().groupCreateJob.create({
      data: {
        deviceId: input.deviceId,
        prefix: input.prefix,
        suffixRule: input.suffixRule,
        count: input.count,
        delaySeconds: input.delaySeconds,
        listIds: JSON.stringify(input.listIds),
        contactsPerGroup: input.contactsPerGroup,
        status: 'running',
      },
    })

    void this.runCreate(job.id).catch((err: unknown) => {
      console.error(`group create job ${job.id} failed`, err)
    })

    return job.id
  }

  private async runCreate(jobId: string): Promise<void> {
    const prisma = getPrisma()
    this.active.add(jobId)

    try {
      const job = await prisma.groupCreateJob.findUnique({ where: { id: jobId } })
      if (!job) return

      const listIds = JSON.parse(job.listIds) as string[]

      // Seed members from the selected lists, taking as many as requested per
      // group. Contacts are consumed in order so groups do not overlap.
      let pool: string[] = []
      if (job.contactsPerGroup > 0 && listIds.length > 0) {
        const contacts = await prisma.contact.findMany({
          where: { listId: { in: listIds }, isValid: true },
          take: job.count * job.contactsPerGroup,
          orderBy: { id: 'asc' },
          select: { phone: true },
        })
        pool = contacts.map((c) => c.phone)
      }

      const results: Array<{ name: string; ok: boolean; id?: string; error?: string }> =
        []

      for (let i = 0; i < job.count; i += 1) {
        const name = groupName(job.prefix, job.suffixRule as SuffixRule, i)
        const participants = pool.splice(0, job.contactsPerGroup)

        try {
          const created = await waBridge.request('group:create', {
            deviceId: job.deviceId,
            subject: name,
            participants,
          })

          await prisma.group.upsert({
            where: { id: created.id },
            create: {
              id: created.id,
              deviceId: job.deviceId,
              name: created.name,
              memberCount: created.memberCount,
              isAdmin: true,
            },
            update: { name: created.name, memberCount: created.memberCount },
          })

          await prisma.groupCreateJob.update({
            where: { id: jobId },
            data: { createdCount: { increment: 1 } },
          })
          results.push({ name, ok: true, id: created.id })

          // WhatsApp privacy settings can silently prevent adding a contact,
          // so a group with fewer members than requested is normal — recorded
          // rather than treated as failure.
          if (created.memberCount < participants.length) {
            results[results.length - 1]!.error =
              `${participants.length - created.memberCount} participant(s) could not be added (privacy settings)`
          }
        } catch (err) {
          await prisma.groupCreateJob.update({
            where: { id: jobId },
            data: { failedCount: { increment: 1 } },
          })
          results.push({
            name,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        this.progress?.({
          jobId,
          kind: 'create',
          done: i + 1,
          total: job.count,
          status: 'running',
        })

        if (job.delaySeconds > 0 && i < job.count - 1) {
          await new Promise((r) => setTimeout(r, job.delaySeconds * 1_000))
        }
      }

      await prisma.groupCreateJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          resultLog: JSON.stringify(results),
        },
      })
      this.progress?.({
        jobId,
        kind: 'create',
        done: job.count,
        total: job.count,
        status: 'completed',
      })
    } finally {
      this.active.delete(jobId)
    }
  }
}

export const groupRunner = new GroupRunner()

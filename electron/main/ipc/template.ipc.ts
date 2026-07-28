/**
 * Template channels.
 *
 * Media is copied into a managed store under userData rather than referenced in
 * place: a campaign scheduled for next week must still be able to send its
 * image after the user has moved or deleted the original file.
 */
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { AppError } from '../../../shared/errors'
import { renderTemplate } from '../../../shared/merge-tags'
import { MAX_TEMPLATE_BUTTONS } from '../../../shared/types'
import { getPrisma } from '../db/client'
import { mediaDir } from '../db/paths'
import { registerHandler } from './router'

/** WhatsApp's practical limits; larger files are rejected before they are copied. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_VIDEO_BYTES = 16 * 1024 * 1024

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const VIDEO_EXT = new Set(['.mp4', '.3gp', '.mkv'])

function parseJsonArray(value: string | null): string[] | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : null
  } catch {
    return null
  }
}

function serialize(row: {
  id: string
  name: string
  type: string
  content: string
  mediaType: string | null
  mediaPath: string | null
  options: string | null
  buttons: string | null
  createdAt: Date
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type as 'text' | 'media' | 'interactive' | 'button',
    content: row.content,
    mediaType: (row.mediaType as 'image' | 'video' | null) ?? null,
    mediaPath: row.mediaPath,
    options: parseJsonArray(row.options),
    buttons: parseJsonArray(row.buttons),
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Copy a chosen file into the app's media store and return the stored path.
 * Validation happens before the copy so an oversized file never lands on disk.
 */
function storeMedia(
  templateId: string,
  sourcePath: string,
  mediaType: 'image' | 'video',
): string {
  let size: number
  try {
    size = statSync(sourcePath).size
  } catch {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'That media file could not be read.',
    })
  }

  const ext = extname(sourcePath).toLowerCase()
  const allowed = mediaType === 'image' ? IMAGE_EXT : VIDEO_EXT
  if (!allowed.has(ext)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `${ext || 'That file type'} is not supported for ${mediaType} messages.`,
    })
  }

  const limit = mediaType === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
  if (size > limit) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `That file is ${(size / 1024 / 1024).toFixed(1)} MB. WhatsApp accepts up to ${
        limit / 1024 / 1024
      } MB for ${mediaType}s.`,
    })
  }

  const dir = mediaDir('templates', templateId)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, basename(sourcePath))
  copyFileSync(sourcePath, target)
  return target
}

function validateButtons(buttons: string[] | undefined): string[] | undefined {
  if (!buttons) return undefined
  const cleaned = buttons.map((b) => b.trim()).filter((b) => b !== '')
  if (cleaned.length > MAX_TEMPLATE_BUTTONS) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `WhatsApp allows at most ${MAX_TEMPLATE_BUTTONS} buttons.`,
    })
  }
  return cleaned
}

async function requireTemplate(id: string) {
  const template = await getPrisma().template.findUnique({ where: { id } })
  if (!template) {
    throw new AppError('NOT_FOUND', { userMessage: 'That template no longer exists.' })
  }
  return template
}

export function registerTemplateHandlers(): void {
  registerHandler('template:list', async () => {
    const rows = await getPrisma().template.findMany({ orderBy: { createdAt: 'desc' } })
    return rows.map(serialize)
  })

  registerHandler('template:create', async (input) => {
    const name = input.name.trim()
    if (name === '') {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'A template name is required.',
      })
    }

    const buttons = validateButtons(input.buttons)
    const options = input.options?.map((o) => o.trim()).filter((o) => o !== '')

    if (input.type === 'media' && !input.mediaSourcePath) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Choose an image or video for a media template.',
      })
    }

    const created = await getPrisma().template.create({
      data: {
        name,
        type: input.type,
        content: input.content,
        mediaType: input.mediaType ?? null,
        options: options ? JSON.stringify(options) : null,
        buttons: buttons ? JSON.stringify(buttons) : null,
      },
    })

    if (input.mediaSourcePath && input.mediaType) {
      try {
        const mediaPath = storeMedia(created.id, input.mediaSourcePath, input.mediaType)
        const withMedia = await getPrisma().template.update({
          where: { id: created.id },
          data: { mediaPath },
        })
        return serialize(withMedia)
      } catch (err) {
        // Do not leave a media template behind with no media — it would fail
        // at send time, long after the user could connect cause and effect.
        await getPrisma().template.delete({ where: { id: created.id } })
        throw err
      }
    }

    return serialize(created)
  })

  registerHandler('template:update', async (input) => {
    const existing = await requireTemplate(input.id)
    const buttons = validateButtons(input.buttons)
    const options = input.options?.map((o) => o.trim()).filter((o) => o !== '')

    let mediaPath = existing.mediaPath
    if (input.mediaSourcePath && (input.mediaType ?? existing.mediaType)) {
      mediaPath = storeMedia(
        existing.id,
        input.mediaSourcePath,
        (input.mediaType ?? existing.mediaType) as 'image' | 'video',
      )
    }

    const updated = await getPrisma().template.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.mediaType !== undefined ? { mediaType: input.mediaType } : {}),
        ...(mediaPath !== existing.mediaPath ? { mediaPath } : {}),
        ...(options ? { options: JSON.stringify(options) } : {}),
        ...(buttons ? { buttons: JSON.stringify(buttons) } : {}),
      },
    })
    return serialize(updated)
  })

  registerHandler('template:usage', async ({ id }) => {
    await requireTemplate(id)
    const [campaigns, groupJobs] = await Promise.all([
      getPrisma().campaign.findMany({
        where: { templateId: id },
        select: { id: true, name: true },
      }),
      getPrisma().groupSendJob.count({ where: { templateId: id } }),
    ])
    return { campaigns, groupJobs }
  })

  registerHandler('template:delete', async ({ id }) => {
    await requireTemplate(id)

    // A template referenced by a campaign cannot be removed: the campaign's
    // queue rows would still point at it and the send would fail mid-run.
    const usedBy = await getPrisma().campaign.count({ where: { templateId: id } })
    if (usedBy > 0) {
      throw new AppError('CONFLICT', {
        userMessage: `This template is used by ${usedBy} campaign${
          usedBy === 1 ? '' : 's'
        } and cannot be deleted.`,
      })
    }

    await getPrisma().template.delete({ where: { id } })
    rmSync(mediaDir('templates', id), { recursive: true, force: true })
    return { ok: true as const }
  })

  registerHandler('template:preview', async ({ id, contactId }) => {
    const template = await requireTemplate(id)

    // Preview against a real contact when one is given, so what the user sees
    // is exactly what that person would receive.
    let values: Record<string, string> = {}
    if (contactId) {
      const contact = await getPrisma().contact.findUnique({ where: { id: contactId } })
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
    }

    const { text, unresolved } = renderTemplate(template.content, values)
    return { rendered: text, unresolvedTags: unresolved }
  })
}

/**
 * Contact list and contact channels.
 *
 * All listing is cursor-paginated and searched in SQL. Loading a list into
 * memory to filter it would fall over at the 50,000-row target
 * (CLAUDE.md §5.7).
 */
import { join } from 'node:path'
import { AppError } from '../../../shared/errors'
import { REQUIRED_CONTACT_FIELDS } from '../../../shared/types'
import { getPrisma } from '../db/client'
import { userDataDir } from '../db/paths'
import { exportCsv, importCsv, previewCsv, type ImportRow } from '../services/csv'
import { normalizePhone, resolveCountry } from '../services/phone'
import { registerHandler } from './router'
import { mkdirSync } from 'node:fs'

function parseFields(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed)
      ? parsed.filter((f): f is string => typeof f === 'string')
      : []
  } catch {
    return [...REQUIRED_CONTACT_FIELDS]
  }
}

function parseData(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
          k,
          String(v ?? ''),
        ]),
      )
    }
  } catch {
    // Fall through — a corrupt blob must not take down the whole list.
  }
  return {}
}

function serializeList(row: {
  id: string
  name: string
  fields: string
  contactCount: number
  createdAt: Date
}) {
  return {
    id: row.id,
    name: row.name,
    fields: parseFields(row.fields),
    contactCount: row.contactCount,
    createdAt: row.createdAt.toISOString(),
  }
}

function serializeContact(row: {
  id: string
  listId: string
  name: string
  phone: string
  data: string
  isValid: boolean
}) {
  return {
    id: row.id,
    listId: row.listId,
    name: row.name,
    phone: row.phone,
    data: parseData(row.data),
    isValid: row.isValid,
  }
}

async function requireList(id: string) {
  const list = await getPrisma().contactList.findUnique({ where: { id } })
  if (!list)
    throw new AppError('NOT_FOUND', {
      userMessage: 'That contact list no longer exists.',
    })
  return list
}

async function countryCode() {
  const setting = await getPrisma().setting.findUnique({
    where: { key: 'contacts.defaultCountryCode' },
  })
  return resolveCountry(setting?.value)
}

async function duplicatePolicy(): Promise<'skip' | 'overwrite' | 'allow'> {
  const setting = await getPrisma().setting.findUnique({
    where: { key: 'contacts.duplicatePolicy' },
  })
  const value = setting?.value
  return value === 'overwrite' || value === 'allow' ? value : 'skip'
}

/** Recount from rows rather than incrementing, so the cache cannot drift. */
async function refreshCount(listId: string): Promise<number> {
  const contactCount = await getPrisma().contact.count({ where: { listId } })
  await getPrisma().contactList.update({ where: { id: listId }, data: { contactCount } })
  return contactCount
}

export function registerContactHandlers(): void {
  // ── lists ──

  registerHandler('contactList:list', async () => {
    const rows = await getPrisma().contactList.findMany({ orderBy: { createdAt: 'asc' } })
    return rows.map(serializeList)
  })

  registerHandler('contactList:create', async ({ name, customFields }) => {
    const trimmed = name.trim()
    if (trimmed === '') {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'A list name is required.' })
    }

    const existing = await getPrisma().contactList.findUnique({
      where: { name: trimmed },
    })
    if (existing) {
      throw new AppError('CONFLICT', {
        userMessage: 'A list with that name already exists.',
      })
    }

    // Name and Mobile are mandatory and always first; custom fields are
    // de-duplicated against them so a user typing "Name" cannot create a
    // column that shadows the promoted one.
    const extras = customFields
      .map((f) => f.trim())
      .filter((f) => f !== '')
      .filter(
        (f) => !REQUIRED_CONTACT_FIELDS.some((r) => r.toLowerCase() === f.toLowerCase()),
      )

    const fields = [...REQUIRED_CONTACT_FIELDS, ...Array.from(new Set(extras))]

    const created = await getPrisma().contactList.create({
      data: { name: trimmed, fields: JSON.stringify(fields) },
    })
    return serializeList(created)
  })

  registerHandler('contactList:update', async ({ id, name }) => {
    const list = await requireList(id)
    const updated = await getPrisma().contactList.update({
      where: { id },
      data: { name: name?.trim() ?? list.name },
    })
    return serializeList(updated)
  })

  registerHandler('contactList:delete', async ({ id }) => {
    await requireList(id)
    // Contacts cascade via the schema relation.
    await getPrisma().contactList.delete({ where: { id } })
    return { ok: true as const }
  })

  // ── contacts ──

  registerHandler('contacts:list', async ({ listId, search, cursor, limit }) => {
    await requireList(listId)

    const where = {
      listId,
      ...(search && search.trim() !== ''
        ? {
            OR: [
              { name: { contains: search.trim() } },
              { phone: { contains: search.trim() } },
            ],
          }
        : {}),
    }

    const [rows, total] = await Promise.all([
      getPrisma().contact.findMany({
        where,
        orderBy: { id: 'asc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      getPrisma().contact.count({ where }),
    ])

    // One extra row is fetched purely to know whether another page exists.
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return {
      items: page.map(serializeContact),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      total,
    }
  })

  registerHandler('contacts:create', async ({ listId, data }) => {
    await requireList(listId)
    const country = await countryCode()

    const normalized = normalizePhone(data.Mobile ?? '', country)
    if (!normalized.e164) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Enter a valid phone number including country code.',
      })
    }

    const payload: Record<string, string> = { ...data, Mobile: normalized.e164 }
    const created = await getPrisma().contact.create({
      data: {
        listId,
        name: payload.Name ?? '',
        phone: normalized.e164,
        data: JSON.stringify(payload),
        isValid: normalized.valid,
      },
    })
    await refreshCount(listId)
    return serializeContact(created)
  })

  registerHandler('contacts:update', async ({ id, data }) => {
    const existing = await getPrisma().contact.findUnique({ where: { id } })
    if (!existing)
      throw new AppError('NOT_FOUND', { userMessage: 'That contact no longer exists.' })

    const country = await countryCode()
    const normalized = normalizePhone(data.Mobile ?? existing.phone, country)
    if (!normalized.e164) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Enter a valid phone number including country code.',
      })
    }

    const payload: Record<string, string> = { ...data, Mobile: normalized.e164 }
    const updated = await getPrisma().contact.update({
      where: { id },
      data: {
        name: payload.Name ?? existing.name,
        phone: normalized.e164,
        data: JSON.stringify(payload),
        isValid: normalized.valid,
      },
    })
    return serializeContact(updated)
  })

  registerHandler('contacts:delete', async ({ id }) => {
    const existing = await getPrisma().contact.findUnique({ where: { id } })
    if (!existing)
      throw new AppError('NOT_FOUND', { userMessage: 'That contact no longer exists.' })
    await getPrisma().contact.delete({ where: { id } })
    await refreshCount(existing.listId)
    return { ok: true as const }
  })

  registerHandler('contacts:bulkDelete', async ({ ids }) => {
    const first = await getPrisma().contact.findUnique({ where: { id: ids[0]! } })
    await getPrisma().contact.deleteMany({ where: { id: { in: ids } } })
    if (first) await refreshCount(first.listId)
    return { ok: true as const }
  })

  // ── import / export ──

  registerHandler('contacts:importPreview', async ({ filePath }) => {
    try {
      return await previewCsv(filePath)
    } catch (err) {
      throw new AppError('IMPORT_FAILED', {
        userMessage: err instanceof Error ? err.message : 'The file could not be read.',
        detail: String(err),
      })
    }
  })

  registerHandler(
    'contacts:import',
    async ({ listId, filePath, mapping, duplicatePolicy: policyArg }) => {
      const list = await requireList(listId)
      const country = await countryCode()
      const policy = policyArg ?? (await duplicatePolicy())

      const exportsDir = join(userDataDir(), 'exports')
      mkdirSync(exportsDir, { recursive: true })

      const prisma = getPrisma()

      try {
        const outcome = await importCsv(filePath, mapping, {
          country,
          exportsDir,
          writeBatch: async (rows: ImportRow[]) => {
            // Within-file duplicates would otherwise make createMany fail the
            // whole batch on the unique(listId, phone) constraint.
            const seen = new Set<string>()
            const deduped = rows.filter((r) => {
              if (seen.has(r.phone)) return false
              seen.add(r.phone)
              return true
            })
            let skipped = rows.length - deduped.length

            if (policy === 'overwrite') {
              // upsert cannot be batched, so this path is slower by design —
              // correctness first, and overwriting is not the default.
              let written = 0
              await prisma.$transaction(async (tx) => {
                for (const row of deduped) {
                  await tx.contact.upsert({
                    where: { listId_phone: { listId, phone: row.phone } },
                    create: {
                      listId,
                      name: row.name,
                      phone: row.phone,
                      data: JSON.stringify(row.data),
                    },
                    update: { name: row.name, data: JSON.stringify(row.data) },
                  })
                  written += 1
                }
              })
              return { written, skipped }
            }

            // Prisma's `skipDuplicates` is not supported on SQLite, so
            // already-present numbers are filtered explicitly. One indexed
            // query per batch of 1,000 is far cheaper than per-row upserts.
            const existing = await prisma.contact.findMany({
              where: { listId, phone: { in: deduped.map((r) => r.phone) } },
              select: { phone: true },
            })
            const present = new Set(existing.map((e) => e.phone))
            const fresh = deduped.filter((r) => !present.has(r.phone))
            skipped += deduped.length - fresh.length

            if (fresh.length === 0) return { written: 0, skipped }

            const result = await prisma.contact.createMany({
              data: fresh.map((row) => ({
                listId,
                name: row.name,
                phone: row.phone,
                data: JSON.stringify(row.data),
              })),
            })
            return { written: result.count, skipped }
          },
        })

        await refreshCount(listId)
        return outcome
      } catch (err) {
        throw new AppError('IMPORT_FAILED', {
          userMessage: err instanceof Error ? err.message : 'The import failed.',
          detail: `list=${list.name}: ${String(err)}`,
        })
      }
    },
  )

  registerHandler('contacts:export', async ({ listId, search }) => {
    const list = await requireList(listId)
    const fields = parseFields(list.fields)

    const exportsDir = join(userDataDir(), 'exports')
    mkdirSync(exportsDir, { recursive: true })
    const targetPath = join(
      exportsDir,
      `${list.name.replace(/[^\w\-. ]+/g, '_')}-${Date.now()}.csv`,
    )

    const where = {
      listId,
      ...(search && search.trim() !== ''
        ? {
            OR: [
              { name: { contains: search.trim() } },
              { phone: { contains: search.trim() } },
            ],
          }
        : {}),
    }

    try {
      const rows = await exportCsv({
        fields,
        targetPath,
        readPage: async (cursor) => {
          const page = await getPrisma().contact.findMany({
            where,
            orderBy: { id: 'asc' },
            take: 1_001,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          })
          const hasMore = page.length > 1_000
          const slice = hasMore ? page.slice(0, 1_000) : page
          return {
            rows: slice.map((r) => ({ id: r.id, data: parseData(r.data) })),
            nextCursor: hasMore ? (slice[slice.length - 1]?.id ?? null) : null,
          }
        },
      })
      return { filePath: targetPath, rows }
    } catch (err) {
      throw new AppError('EXPORT_FAILED', { detail: String(err) })
    }
  })
}

/**
 * CSV import and export (SPRINTS.md §6.7).
 *
 * The importer streams rather than reading the file into memory, and inserts in
 * transactional batches. A 50,000-row file is a normal case for this app, and
 * loading one as a single array plus 50,000 individual inserts would both
 * exhaust memory and take minutes.
 */
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { normalizePhone, type DialPrefix } from './phone'

export const IMPORT_BATCH_SIZE = 1_000
/** Guardrail: a file this large is almost certainly not a contact list. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024

/**
 * Split one CSV line, honoring quoted fields and doubled quotes.
 *
 * Hand-written rather than pulled from a parser library because the importer
 * streams line by line, and the common parsers want to own the whole file or
 * the whole stream. This handles the RFC 4180 cases that actually appear in
 * exported contact lists.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') inQuotes = true
    else if (ch === ',') {
      out.push(field)
      field = ''
    } else field += ch
  }

  out.push(field)
  return out.map((f) => f.trim())
}

export function toCsvValue(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export interface CsvPreview {
  headers: string[]
  sampleRows: string[][]
  totalRows: number
}

/** Read headers and a handful of rows without loading the file. */
export async function previewCsv(filePath: string, sampleSize = 5): Promise<CsvPreview> {
  if (!existsSync(filePath)) throw new Error('File not found')
  if (statSync(filePath).size > MAX_IMPORT_BYTES)
    throw new Error('File is too large to import')

  const reader = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  let headers: string[] = []
  const sampleRows: string[][] = []
  let totalRows = 0

  for await (const line of reader) {
    if (line.trim() === '') continue
    if (headers.length === 0) {
      headers = parseCsvLine(line)
      continue
    }
    totalRows += 1
    if (sampleRows.length < sampleSize) sampleRows.push(parseCsvLine(line))
  }
  reader.close()

  if (headers.length === 0) throw new Error('The file appears to be empty')
  return { headers, sampleRows, totalRows }
}

export type DuplicatePolicy = 'skip' | 'overwrite' | 'allow'

export interface ImportRow {
  name: string
  phone: string
  data: Record<string, string>
}

export interface ImportOutcome {
  imported: number
  skipped: number
  invalid: number
  errorReportPath: string | null
}

export interface ImportDeps {
  /** Persist one batch; returns how many were written and how many skipped. */
  writeBatch: (rows: ImportRow[]) => Promise<{ written: number; skipped: number }>
  onProgress?: (processed: number, total: number) => void
  exportsDir: string
  /**
   * Dial prefix to apply to national numbers, e.g. `+91`. Undefined means the
   * user stated the file's numbers already carry their country code, so one
   * that does not is reported as invalid rather than guessed at.
   */
  dialPrefix?: DialPrefix
}

/**
 * Stream a CSV into contact rows.
 *
 * `mapping` maps a CSV header to a list field name. It is explicit rather than
 * positional (which is what the prototype did) because a column order change in
 * an exported file would otherwise silently shuffle everyone's data.
 */
export async function importCsv(
  filePath: string,
  mapping: Record<string, string>,
  deps: ImportDeps,
  total = 0,
): Promise<ImportOutcome> {
  if (!existsSync(filePath)) throw new Error('File not found')

  const reader = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  let headers: string[] = []
  let batch: ImportRow[] = []
  let imported = 0
  let skipped = 0
  let invalid = 0
  let processed = 0

  const errors: string[] = []

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    const result = await deps.writeBatch(batch)
    imported += result.written
    skipped += result.skipped
    batch = []
  }

  for await (const line of reader) {
    if (line.trim() === '') continue

    if (headers.length === 0) {
      headers = parseCsvLine(line)
      continue
    }

    processed += 1
    const cells = parseCsvLine(line)
    const record: Record<string, string> = {}

    headers.forEach((header, index) => {
      const field = mapping[header]
      if (field) record[field] = cells[index] ?? ''
    })

    const rawPhone = record.Mobile ?? ''
    const normalized = normalizePhone(rawPhone, deps.dialPrefix)

    if (!normalized.valid || !normalized.e164) {
      invalid += 1
      // Row number is 1-based and counts the header, matching what a
      // spreadsheet shows the user.
      errors.push(
        `${processed + 1},${toCsvValue(rawPhone)},${toCsvValue(normalized.reason ?? 'invalid')}`,
      )
      continue
    }

    record.Mobile = normalized.e164
    batch.push({
      name: record.Name ?? '',
      phone: normalized.e164,
      data: record,
    })

    if (batch.length >= IMPORT_BATCH_SIZE) {
      await flush()
      deps.onProgress?.(processed, total)
    }
  }

  await flush()
  reader.close()
  deps.onProgress?.(processed, total)

  let errorReportPath: string | null = null
  if (errors.length > 0) {
    errorReportPath = join(deps.exportsDir, `import-errors-${Date.now()}.csv`)
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(errorReportPath!, { encoding: 'utf8' })
      stream.on('error', reject)
      stream.on('finish', () => resolve())
      stream.write('row,value,reason\n')
      for (const row of errors) stream.write(`${row}\n`)
      stream.end()
    })
  }

  return { imported, skipped, invalid, errorReportPath }
}

export interface ExportDeps {
  /** Page through contacts so export never holds the whole list in memory. */
  readPage: (cursor: string | undefined) => Promise<{
    rows: Array<{ id: string; data: Record<string, string> }>
    nextCursor: string | null
  }>
  fields: string[]
  targetPath: string
}

export async function exportCsv(deps: ExportDeps): Promise<number> {
  const stream = createWriteStream(deps.targetPath, { encoding: 'utf8' })
  let written = 0

  try {
    stream.write(`${deps.fields.map(toCsvValue).join(',')}\n`)

    let cursor: string | undefined
    do {
      const page = await deps.readPage(cursor)
      for (const row of page.rows) {
        stream.write(
          `${deps.fields.map((f) => toCsvValue(row.data[f] ?? '')).join(',')}\n`,
        )
        written += 1
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject)
      stream.on('finish', () => resolve())
      stream.end()
    })
  }

  return written
}

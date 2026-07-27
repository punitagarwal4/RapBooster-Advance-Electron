import { expect, test } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  cleanupUserDataDir,
  launchLicensed,
  newUserDataDir,
} from './fixtures/licensed-app'

/**
 * Sprint 2 — contact lists, import and export (SPRINTS.md §10.3, E2.11–E2.16).
 */

function contactCount(dir: string, listId: string): number {
  const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM Contact WHERE listId = ?')
      .get(listId) as { n: number }
    return Number(row.n)
  } finally {
    db.close()
  }
}

function writeCsv(dir: string, name: string, lines: string[]): string {
  const path = join(dir, name)
  writeFileSync(path, lines.join('\n'), 'utf8')
  return path
}

test('E2.11 — a list is created with custom fields and Name/Mobile always first', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const created = await win.evaluate(() =>
      window.api.invoke('contactList:create', {
        name: 'Leads',
        // "name" collides with the mandatory field and must not duplicate it.
        customFields: ['Company', 'Status', 'name', ''],
      }),
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(created.data.fields).toEqual(['Name', 'Mobile', 'Company', 'Status'])

    // Duplicate list names are refused.
    const dupe = await win.evaluate(() =>
      window.api.invoke('contactList:create', { name: 'Leads', customFields: [] }),
    )
    expect(dupe.ok).toBe(false)
    if (!dupe.ok) expect(dupe.error.code).toBe('CONFLICT')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E2.12 — a 50,000-row CSV imports with counts reconciling', async () => {
  const dir = newUserDataDir()
  const files = mkdtempSync(join(tmpdir(), 'rapbooster-csv-'))
  const { app, win } = await launchLicensed(dir)
  try {
    const ROWS = 50_000
    const lines = ['Name,Mobile,Company']
    for (let i = 0; i < ROWS; i += 1) {
      // Valid Indian mobile numbers: 10 digits starting with 6-9.
      lines.push(`Person ${i},9${String(800000000 + i).padStart(9, '0')},Acme ${i % 50}`)
    }
    const csv = writeCsv(files, 'contacts-50k.csv', lines)

    const listId = await win.evaluate(async () => {
      const r = await window.api.invoke('contactList:create', {
        name: 'Bulk',
        customFields: ['Company'],
      })
      return r.ok ? r.data.id : ''
    })
    expect(listId).not.toBe('')

    const preview = await win.evaluate(
      (p) => window.api.invoke('contacts:importPreview', { filePath: p }),
      csv,
    )
    expect(preview.ok).toBe(true)
    if (preview.ok) {
      expect(preview.data.headers).toEqual(['Name', 'Mobile', 'Company'])
      expect(preview.data.totalRows).toBe(ROWS)
    }

    const started = Date.now()
    const result = await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile', Company: 'Company' },
          duplicatePolicy: 'skip',
        }),
      { id: listId, p: csv },
    )
    const elapsed = Date.now() - started

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.imported).toBe(ROWS)
    expect(result.data.invalid).toBe(0)
    expect(contactCount(dir, listId)).toBe(ROWS)
    // Not a hard budget, but a 50k import taking minutes would mean the
    // streaming/batching regressed into per-row work.
    expect(elapsed).toBeLessThan(180_000)

    // Numbers are stored normalized to E.164, which is what the send path uses.
    const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
    try {
      const row = db
        .prepare('SELECT phone FROM Contact WHERE listId = ? LIMIT 1')
        .get(listId) as { phone: string }
      expect(row.phone).toMatch(/^\+91\d{10}$/)
    } finally {
      db.close()
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
    rmSync(files, { recursive: true, force: true })
  }
})

test('E2.13 — duplicates are skipped, within the file and against existing rows', async () => {
  const dir = newUserDataDir()
  const files = mkdtempSync(join(tmpdir(), 'rapbooster-csv-'))
  const { app, win } = await launchLicensed(dir)
  try {
    const csv = writeCsv(files, 'dupes.csv', [
      'Name,Mobile',
      'A,9876543210',
      'B,9876543211',
      // Same number as A, written differently — normalization must catch it.
      'C,+91 98765 43210',
    ])

    const listId = await win.evaluate(async () => {
      const r = await window.api.invoke('contactList:create', { name: 'Dupes', customFields: [] })
      return r.ok ? r.data.id : ''
    })

    const first = await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile' },
          duplicatePolicy: 'skip',
        }),
      { id: listId, p: csv },
    )
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.data.imported).toBe(2)
      expect(first.data.skipped).toBe(1)
    }
    expect(contactCount(dir, listId)).toBe(2)

    // Re-importing the same file must add nothing.
    const second = await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile' },
          duplicatePolicy: 'skip',
        }),
      { id: listId, p: csv },
    )
    if (second.ok) expect(second.data.imported).toBe(0)
    expect(contactCount(dir, listId)).toBe(2)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
    rmSync(files, { recursive: true, force: true })
  }
})

test('E2.14 — malformed numbers are rejected with a downloadable error report', async () => {
  const dir = newUserDataDir()
  const files = mkdtempSync(join(tmpdir(), 'rapbooster-csv-'))
  const { app, win } = await launchLicensed(dir)
  try {
    const csv = writeCsv(files, 'bad.csv', [
      'Name,Mobile',
      'Good,9876543210',
      'Empty,',
      'Letters,not-a-number',
      'TooShort,12',
    ])

    const listId = await win.evaluate(async () => {
      const r = await window.api.invoke('contactList:create', { name: 'Bad', customFields: [] })
      return r.ok ? r.data.id : ''
    })

    const result = await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile' },
          duplicatePolicy: 'skip',
        }),
      { id: listId, p: csv },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.imported).toBe(1)
    expect(result.data.invalid).toBe(3)
    // A rejection the user cannot inspect is not actionable.
    expect(result.data.errorReportPath).not.toBeNull()
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
    rmSync(files, { recursive: true, force: true })
  }
})

test('E2.15 — export round-trips back to an identical list', async () => {
  const dir = newUserDataDir()
  const files = mkdtempSync(join(tmpdir(), 'rapbooster-csv-'))
  const { app, win } = await launchLicensed(dir)
  try {
    // Deliberately includes a comma and a quote, which naive CSV writers break on.
    const csv = writeCsv(files, 'round.csv', [
      'Name,Mobile,Notes',
      'Alice,9876543210,"Prefers email, mornings"',
      'Bob,9876543211,"Said ""maybe"""',
    ])

    const ids = await win.evaluate(async () => {
      const a = await window.api.invoke('contactList:create', {
        name: 'Source',
        customFields: ['Notes'],
      })
      const b = await window.api.invoke('contactList:create', {
        name: 'Target',
        customFields: ['Notes'],
      })
      return { source: a.ok ? a.data.id : '', target: b.ok ? b.data.id : '' }
    })

    await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile', Notes: 'Notes' },
          duplicatePolicy: 'skip',
        }),
      { id: ids.source, p: csv },
    )

    const exported = await win.evaluate(
      (id) => window.api.invoke('contacts:export', { listId: id }),
      ids.source,
    )
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    expect(exported.data.rows).toBe(2)

    const reimported = await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile', Notes: 'Notes' },
          duplicatePolicy: 'skip',
        }),
      { id: ids.target, p: exported.data.filePath },
    )
    expect(reimported.ok).toBe(true)
    if (reimported.ok) expect(reimported.data.imported).toBe(2)

    const rows = await win.evaluate(
      (id) => window.api.invoke('contacts:list', { listId: id, limit: 50 }),
      ids.target,
    )
    expect(rows.ok).toBe(true)
    if (!rows.ok) return

    const alice = rows.data.items.find((c) => c.name === 'Alice')
    // Quoting survived the round trip in both directions.
    expect(alice?.data.Notes).toBe('Prefers email, mornings')
    const bob = rows.data.items.find((c) => c.name === 'Bob')
    expect(bob?.data.Notes).toBe('Said "maybe"')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
    rmSync(files, { recursive: true, force: true })
  }
})

test('E2.16 — search across a large list stays fast and paginates', async () => {
  const dir = newUserDataDir()
  const files = mkdtempSync(join(tmpdir(), 'rapbooster-csv-'))
  const { app, win } = await launchLicensed(dir)
  try {
    const ROWS = 20_000
    const lines = ['Name,Mobile']
    for (let i = 0; i < ROWS; i += 1) {
      lines.push(`Person ${i},9${String(700000000 + i).padStart(9, '0')}`)
    }
    const csv = writeCsv(files, 'search.csv', lines)

    const listId = await win.evaluate(async () => {
      const r = await window.api.invoke('contactList:create', { name: 'Search', customFields: [] })
      return r.ok ? r.data.id : ''
    })

    await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile' },
          duplicatePolicy: 'skip',
        }),
      { id: listId, p: csv },
    )

    const timing = await win.evaluate(async (id) => {
      const started = performance.now()
      const r = await window.api.invoke('contacts:list', {
        listId: id,
        search: 'Person 1234',
        limit: 100,
      })
      return { ms: performance.now() - started, ok: r.ok, total: r.ok ? r.data.total : -1 }
    }, listId)

    expect(timing.ok).toBe(true)
    expect(timing.total).toBeGreaterThan(0)
    // CLAUDE.md §5.7 budget: search must stay under 500ms at this scale.
    expect(timing.ms).toBeLessThan(500)

    // Pagination returns a cursor and does not repeat rows.
    const first = await win.evaluate(
      (id) => window.api.invoke('contacts:list', { listId: id, limit: 100 }),
      listId,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.items).toHaveLength(100)
    expect(first.data.total).toBe(ROWS)
    expect(first.data.nextCursor).not.toBeNull()

    const second = await win.evaluate(
      ({ id, c }) => window.api.invoke('contacts:list', { listId: id, limit: 100, cursor: c }),
      { id: listId, c: first.data.nextCursor! },
    )
    if (second.ok) {
      const firstIds = new Set(first.data.items.map((i) => i.id))
      expect(second.data.items.some((i) => firstIds.has(i.id))).toBe(false)
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
    rmSync(files, { recursive: true, force: true })
  }
})

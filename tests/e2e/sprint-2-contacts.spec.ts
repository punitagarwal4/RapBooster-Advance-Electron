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
          dialPrefix: '+91',
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
      const r = await window.api.invoke('contactList:create', {
        name: 'Dupes',
        customFields: [],
      })
      return r.ok ? r.data.id : ''
    })

    const first = await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile' },
          duplicatePolicy: 'skip',
          dialPrefix: '+91',
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
          dialPrefix: '+91',
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
      const r = await window.api.invoke('contactList:create', {
        name: 'Bad',
        customFields: [],
      })
      return r.ok ? r.data.id : ''
    })

    const result = await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile' },
          duplicatePolicy: 'skip',
          dialPrefix: '+91',
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

test('E2.14b — national numbers are rejected, not guessed, when none is chosen', async () => {
  const dir = newUserDataDir()
  const files = mkdtempSync(join(tmpdir(), 'rapbooster-csv-'))
  const { app, win } = await launchLicensed(dir)
  try {
    const csv = writeCsv(files, 'no-country.csv', [
      'Name,Mobile',
      // National form, no country code — unusable without an answer from the user.
      'National,9876543210',
      // Already international, in the two ways people write it.
      'Plus,+919876543211',
      'DoubleZero,00919876543212',
    ])

    const listId = await win.evaluate(async () => {
      const r = await window.api.invoke('contactList:create', {
        name: 'No country',
        customFields: [],
      })
      return r.ok ? r.data.id : ''
    })

    const result = await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile' },
          duplicatePolicy: 'skip',
          // The user stated the numbers already carry their country code.
          dialPrefix: null,
        }),
      { id: listId, p: csv },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The two international rows import; the national one is reported rather
    // than silently normalized against a country nobody chose.
    expect(result.data.imported).toBe(2)
    expect(result.data.invalid).toBe(1)
    expect(result.data.errorReportPath).not.toBeNull()

    const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
    try {
      const rows = db
        .prepare('SELECT phone FROM Contact WHERE listId = ? ORDER BY phone')
        .all(listId) as { phone: string }[]
      expect(rows.map((r) => r.phone)).toEqual(['+919876543211', '+919876543212'])
    } finally {
      db.close()
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
    rmSync(files, { recursive: true, force: true })
  }
})

test('E2.14c — the import dialog refuses to run until the country code is answered', async () => {
  const dir = newUserDataDir()
  const files = mkdtempSync(join(tmpdir(), 'rapbooster-csv-'))
  const { app, win } = await launchLicensed(dir)
  try {
    const csv = writeCsv(files, 'ui.csv', ['Name,Mobile', 'Asha,9876543210'])

    await win.evaluate(() =>
      window.api.invoke('contactList:create', { name: 'UI', customFields: [] }),
    )
    await win.getByTestId('nav-contacts').click()
    await win.getByTestId('list-tab-UI').click()
    await win.getByTestId('import-contacts').click()

    await win.getByTestId('csv-path').fill(csv)
    await win.getByTestId('load-preview').click()
    await expect(win.getByTestId('country-answer')).toBeVisible()

    // Nothing is preselected, so importing now must fail loudly rather than
    // fall back to a country nobody chose.
    await win.getByTestId('run-import').click()
    await expect(win.getByTestId('import-error')).toContainText('country code')

    await win.getByTestId('country-answer').selectOption('apply')
    await win.getByTestId('dial-prefix').fill('+91')
    await win.getByTestId('run-import').click()

    await expect(win.getByTestId('import-dialog')).toBeHidden()
    const stored = await win.evaluate(async () => {
      const lists = await window.api.invoke('contactList:list', undefined)
      if (!lists.ok) return []
      const list = lists.data.find((l) => l.name === 'UI')
      if (!list) return []
      const page = await window.api.invoke('contacts:list', { listId: list.id })
      return page.ok ? page.data.items.map((c) => c.phone) : []
    })
    expect(stored).toEqual(['+919876543210'])
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
          dialPrefix: '+91',
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
          dialPrefix: '+91',
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

test('E2.17 — the contacts screen virtualizes a large list and searches it', async () => {
  const dir = newUserDataDir()
  const files = mkdtempSync(join(tmpdir(), 'rapbooster-csv-'))
  const { app, win } = await launchLicensed(dir)
  try {
    const ROWS = 10_000
    const lines = ['Name,Mobile']
    for (let i = 0; i < ROWS; i += 1) {
      lines.push(`Person ${i},9${String(600000000 + i).padStart(9, '0')}`)
    }
    const csv = writeCsv(files, 'ui.csv', lines)

    // Create the list through the UI so the dialog is exercised too.
    await win.getByTestId('nav-contacts').click()
    await expect(win.getByTestId('page-title')).toHaveText('Contact Lists')

    await win.getByTestId('new-list').click()
    const nameInput = win.getByTestId('list-name')
    await nameInput.fill('UI List')
    await expect(nameInput).toHaveValue('UI List')
    await win.getByTestId('list-fields').fill('Company')
    await win.getByTestId('submit-list').click()
    await expect(win.getByTestId('create-list-dialog')).toHaveCount(0)

    const listId = await win.evaluate(async () => {
      const r = await window.api.invoke('contactList:list')
      return r.ok ? (r.data.find((l) => l.name === 'UI List')?.id ?? '') : ''
    })
    expect(listId).not.toBe('')

    await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile' },
          duplicatePolicy: 'skip',
          dialPrefix: '+91',
        }),
      { id: listId, p: csv },
    )

    // Re-enter the screen so the table picks up the imported rows.
    await win.getByTestId('nav-dashboard').click()
    await win.getByTestId('nav-contacts').click()
    await expect(win.getByTestId('contacts-total')).toContainText('10,000')

    // Virtualization: the DOM must hold a small window, not 10,000 rows.
    const rendered = await win.getByTestId('contact-row').count()
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(100)

    // Search narrows the list.
    await win.getByTestId('contact-search').fill('Person 4242')
    await expect(win.getByTestId('contacts-total')).not.toContainText('10,000')
    await expect(win.getByTestId('contact-row').first()).toContainText('Person 4242')
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
      const r = await window.api.invoke('contactList:create', {
        name: 'Search',
        customFields: [],
      })
      return r.ok ? r.data.id : ''
    })

    await win.evaluate(
      ({ id, p }) =>
        window.api.invoke('contacts:import', {
          listId: id,
          filePath: p,
          mapping: { Name: 'Name', Mobile: 'Mobile' },
          duplicatePolicy: 'skip',
          dialPrefix: '+91',
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
      return {
        ms: performance.now() - started,
        ok: r.ok,
        total: r.ok ? r.data.total : -1,
      }
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
      ({ id, c }) =>
        window.api.invoke('contacts:list', { listId: id, limit: 100, cursor: c }),
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

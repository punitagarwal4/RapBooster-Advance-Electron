'use client'

import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'

interface Preview {
  headers: string[]
  sampleRows: string[][]
  totalRows: number
}

/**
 * CSV import with an explicit column-mapping step.
 *
 * The prototype mapped columns by position. Making the user confirm the mapping
 * costs one screen and prevents an exported file with reordered columns from
 * silently writing phone numbers into the name field.
 */
export function ImportDialog({
  listId,
  fields,
  onClose,
  onImported,
}: {
  listId: string
  fields: string[]
  onClose: () => void
  onImported: (summary: string) => void
}) {
  const [filePath, setFilePath] = useState('')
  const [preview, setPreview] = useState<Preview>()
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [policy, setPolicy] = useState<'skip' | 'overwrite' | 'allow'>('skip')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function loadPreview() {
    if (filePath.trim() === '') {
      setError('Choose a CSV file first.')
      return
    }
    setBusy(true)
    setError(undefined)

    const result = await window.api.invoke('contacts:importPreview', {
      filePath: filePath.trim(),
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error.userMessage)
      return
    }

    setPreview(result.data)
    // Pre-map headers whose name matches a field, case-insensitively. The user
    // still sees and confirms every mapping.
    const guessed: Record<string, string> = {}
    for (const header of result.data.headers) {
      const match = fields.find((f) => f.toLowerCase() === header.trim().toLowerCase())
      if (match) guessed[header] = match
    }
    setMapping(guessed)
  }

  async function runImport() {
    if (!Object.values(mapping).includes('Mobile')) {
      setError('One column must be mapped to Mobile — it is the number we send to.')
      return
    }
    setBusy(true)
    setError(undefined)

    const result = await window.api.invoke('contacts:import', {
      listId,
      filePath: filePath.trim(),
      mapping,
      duplicatePolicy: policy,
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error.userMessage)
      return
    }

    const { imported, skipped, invalid, errorReportPath } = result.data
    onImported(
      `Imported ${imported}. Skipped ${skipped}. Invalid ${invalid}.` +
        (errorReportPath ? ' An error report was saved to your exports folder.' : ''),
    )
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Import contacts from CSV"
      testId="import-dialog"
      width={640}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {preview ? (
            <Button variant="primary" onClick={() => void runImport()} disabled={busy} data-testid="run-import">
              {busy ? 'Importing…' : `Import ${preview.totalRows} rows`}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void loadPreview()} disabled={busy} data-testid="load-preview">
              {busy ? 'Reading…' : 'Read file'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="csv-path" className="text-xs font-semibold text-ink">
          CSV file path
        </label>
        <input
          id="csv-path"
          data-testid="csv-path"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="C:\Users\you\contacts.csv"
          className="rounded-control border border-line px-2.5 py-2 font-mono text-xs outline-none focus:border-primary"
        />
      </div>

      {preview && (
        <>
          <p className="mt-4 text-xs text-ink-muted">
            {preview.totalRows} rows found. Map each CSV column to a field — unmapped columns are
            ignored.
          </p>

          <div className="mt-2 flex flex-col gap-2" data-testid="column-mapping">
            {preview.headers.map((header) => (
              <div key={header} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate font-mono text-xs text-ink">{header}</span>
                <span className="text-ink-subtle">→</span>
                <select
                  value={mapping[header] ?? ''}
                  data-testid={`map-${header}`}
                  onChange={(e) =>
                    setMapping((current) => {
                      const next = { ...current }
                      if (e.target.value === '') delete next[header]
                      else next[header] = e.target.value
                      return next
                    })
                  }
                  className="flex-1 rounded-control border border-line px-2 py-1.5 text-sm outline-none focus:border-primary"
                >
                  <option value="">— Ignore —</option>
                  {fields.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor="dupe-policy" className="text-xs font-semibold text-ink">
              When a number already exists in this list
            </label>
            <select
              id="dupe-policy"
              data-testid="dupe-policy"
              value={policy}
              onChange={(e) => setPolicy(e.target.value as typeof policy)}
              className="rounded-control border border-line px-2 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="skip">Skip it (keep what is already there)</option>
              <option value="overwrite">Overwrite it with the imported row</option>
              <option value="allow">Import anyway where possible</option>
            </select>
          </div>

          {preview.sampleRows.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-card border border-line">
              <table className="w-full text-xs">
                <thead className="bg-app-bg">
                  <tr>
                    {preview.headers.map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-medium text-ink-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, i) => (
                    <tr key={i} className="border-t border-line">
                      {preview.headers.map((h, j) => (
                        <td key={h} className="truncate px-2 py-1.5 text-ink">
                          {row[j] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="mt-3 text-xs text-danger" role="alert" data-testid="import-error">
          {error}
        </p>
      )}
    </Dialog>
  )
}

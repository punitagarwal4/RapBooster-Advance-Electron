'use client'

import { useMemo, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { useIpcQuery } from '@renderer/hooks/useIpc'
import { groupNamePreview } from '@shared/group-names'
import type { SuffixRule } from '@shared/types'

const SUFFIX_LABEL: Record<SuffixRule, string> = {
  number: 'Sequential Numbers (001, 002, 003...)',
  alphabet: 'Alphabet (A, B, C...)',
  timestamp: 'Timestamp (auto-generated)',
  none: 'No Suffix',
}

/** Create-groups-in-bulk dialog, following the prototype (SPRINTS.md §2.4). */
export function BulkCreateGroupsDialog({
  onClose,
  onStarted,
}: {
  onClose: () => void
  onStarted: (jobId: string) => void
}) {
  const devices = useIpcQuery('device:list')
  const lists = useIpcQuery('contactList:list')

  const [deviceId, setDeviceId] = useState('')
  const [prefix, setPrefix] = useState('')
  const [suffixRule, setSuffixRule] = useState<SuffixRule>('number')
  const [count, setCount] = useState(5)
  const [delaySeconds, setDelaySeconds] = useState(2)
  const [listIds, setListIds] = useState<string[]>([])
  const [contactsPerGroup, setContactsPerGroup] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // Live preview, so the naming rule is obvious before 100 groups exist.
  const preview = useMemo(
    () => groupNamePreview(prefix || 'Group', suffixRule, count),
    [prefix, suffixRule, count],
  )

  async function submit() {
    setError(undefined)
    if (deviceId === '') {
      setError('Choose a device.')
      return
    }
    if (prefix.trim() === '') {
      setError('A group name prefix is required.')
      return
    }

    setBusy(true)
    const result = await window.api.invoke('groupCreate:create', {
      deviceId,
      prefix: prefix.trim(),
      suffixRule,
      count,
      delaySeconds,
      listIds,
      contactsPerGroup,
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error.userMessage)
      return
    }
    onStarted(result.data.jobId)
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create Groups in Bulk"
      testId="bulk-create-dialog"
      width={480}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy}
            data-testid="submit-bulk-create"
          >
            {busy ? 'Starting…' : 'Create Groups'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bulk-device" className="text-xs font-semibold text-ink">
            Select Device
          </label>
          <select
            id="bulk-device"
            data-testid="bulk-device"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="">-- Choose device --</option>
            {(devices.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.status})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="bulk-prefix" className="text-xs font-semibold text-ink">
            Group Name Prefix
          </label>
          <input
            id="bulk-prefix"
            data-testid="bulk-prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="e.g., Sales Team"
            className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="bulk-suffix" className="text-xs font-semibold text-ink">
            Suffix Rule
          </label>
          <select
            id="bulk-suffix"
            data-testid="bulk-suffix"
            value={suffixRule}
            onChange={(e) => setSuffixRule(e.target.value as SuffixRule)}
            className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
          >
            {(Object.keys(SUFFIX_LABEL) as SuffixRule[]).map((rule) => (
              <option key={rule} value={rule}>
                {SUFFIX_LABEL[rule]}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bulk-count" className="text-xs font-semibold text-ink">
              Number of Groups to Create
            </label>
            <input
              id="bulk-count"
              data-testid="bulk-count"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bulk-delay" className="text-xs font-semibold text-ink">
              Delay Between Groups (seconds)
            </label>
            <input
              id="bulk-delay"
              data-testid="bulk-delay"
              type="number"
              min={0}
              max={60}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value))}
              className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-semibold text-ink">
            Add Contacts from Lists
          </legend>
          <div className="max-h-24 overflow-y-auto rounded-control border border-line p-2">
            {(lists.data ?? []).length === 0 && (
              <p className="text-xs text-ink-subtle">No contact lists yet.</p>
            )}
            {(lists.data ?? []).map((list) => (
              <label key={list.id} className="flex items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  data-testid={`bulk-list-${list.id}`}
                  checked={listIds.includes(list.id)}
                  onChange={() =>
                    setListIds((c) =>
                      c.includes(list.id)
                        ? c.filter((x) => x !== list.id)
                        : [...c, list.id],
                    )
                  }
                />
                <span className="truncate">
                  {list.name}{' '}
                  <span className="text-ink-subtle">({list.contactCount})</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="bulk-per-group" className="text-xs font-semibold text-ink">
            Contacts per Group
          </label>
          <input
            id="bulk-per-group"
            data-testid="bulk-per-group"
            type="number"
            min={0}
            max={500}
            value={contactsPerGroup}
            onChange={(e) => setContactsPerGroup(Number(e.target.value))}
            className="w-32 rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
          />
          <p className="text-xs text-ink-subtle">
            WhatsApp privacy settings can stop a contact being added. Groups with fewer
            members than requested are normal, and the result log records which.
          </p>
        </div>

        <div className="rounded-card bg-app-bg px-3 py-2">
          <p className="text-xs font-semibold text-ink">Preview:</p>
          <p className="text-xs text-ink-muted" data-testid="bulk-preview">
            {preview}
          </p>
        </div>

        {error && (
          <p className="text-xs text-danger" role="alert" data-testid="bulk-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

'use client'

import { Contact as ContactIcon } from 'lucide-react'
import { useState } from 'react'
import { ContactTable } from '@renderer/components/contacts/contact-table'
import { ImportDialog } from '@renderer/components/contacts/import-dialog'
import { PageHeader } from '@renderer/components/layout/page-header'
import { useToast } from '@renderer/components/providers/toast-provider'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { useIpcQuery } from '@renderer/hooks/useIpc'
import { cn } from '@renderer/lib/cn'

export default function ContactsPage() {
  const lists = useIpcQuery('contactList:list')
  const toast = useToast()

  const [activeId, setActiveId] = useState<string>()
  const [search, setSearch] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [creatingList, setCreatingList] = useState(false)
  const [addingContact, setAddingContact] = useState(false)
  const [importing, setImporting] = useState(false)

  const [listName, setListName] = useState('')
  const [customFields, setCustomFields] = useState('')
  const [newContact, setNewContact] = useState<Record<string, string>>({})
  const [dialogError, setDialogError] = useState<string>()

  const all = lists.data ?? []
  // Falls back to the first list rather than storing a default, so deleting the
  // selected list cannot leave the screen pointing at nothing.
  const active = all.find((l) => l.id === activeId) ?? all[0]

  async function createList() {
    setDialogError(undefined)
    const result = await window.api.invoke('contactList:create', {
      name: listName,
      customFields: customFields
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f !== ''),
    })
    if (!result.ok) {
      setDialogError(result.error.userMessage)
      return
    }
    setCreatingList(false)
    setListName('')
    setCustomFields('')
    setActiveId(result.data.id)
    lists.refetch()
  }

  async function addContact() {
    if (!active) return
    setDialogError(undefined)
    const result = await window.api.invoke('contacts:create', {
      listId: active.id,
      data: newContact,
    })
    if (!result.ok) {
      setDialogError(result.error.userMessage)
      return
    }
    setAddingContact(false)
    setNewContact({})
    setReloadKey((k) => k + 1)
    lists.refetch()
  }

  async function remove(id: string) {
    const result = await window.api.invoke('contacts:delete', { id })
    if (!result.ok) toast('error', result.error.userMessage)
    setReloadKey((k) => k + 1)
    lists.refetch()
  }

  async function exportList() {
    if (!active) return
    const result = await window.api.invoke('contacts:export', {
      listId: active.id,
      search: search || undefined,
    })
    if (!result.ok) {
      toast('error', result.error.userMessage)
      return
    }
    toast('success', `Exported ${result.data.rows} contacts`)
    await window.api.invoke('system:openPath', { path: result.data.filePath })
  }

  return (
    <>
      <PageHeader
        title="Contact Lists"
        description="Import, organise and export your recipients."
        actions={
          <Button
            variant="primary"
            onClick={() => setCreatingList(true)}
            data-testid="new-list"
          >
            + New List
          </Button>
        }
      />

      {all.length === 0 ? (
        <EmptyState
          icon={ContactIcon}
          title="No contact lists yet."
          description="Create a list, then add contacts by hand or import a CSV."
          action={
            <Button variant="primary" onClick={() => setCreatingList(true)}>
              + New List
            </Button>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex gap-1 border-b border-line px-6 pt-3" role="tablist">
            {all.map((list) => (
              <button
                key={list.id}
                type="button"
                role="tab"
                aria-selected={list.id === active?.id}
                data-testid={`list-tab-${list.name}`}
                onClick={() => {
                  setActiveId(list.id)
                  setSearch('')
                }}
                className={cn(
                  'rounded-t-control px-3 py-1.5 text-sm',
                  list.id === active?.id
                    ? 'bg-primary font-medium text-white'
                    : 'text-ink-muted hover:bg-wa-in hover:text-ink',
                )}
              >
                {list.name}{' '}
                <span className="opacity-70">({list.contactCount.toLocaleString()})</span>
              </button>
            ))}
          </div>

          {active && (
            <>
              <div className="flex flex-wrap items-center gap-2 px-6 py-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search contacts..."
                  data-testid="contact-search"
                  className="w-56 rounded-control border border-line px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                <Button
                  size="sm"
                  onClick={() => setAddingContact(true)}
                  data-testid="add-contact"
                >
                  + Add Contact
                </Button>
                <Button
                  size="sm"
                  onClick={() => setImporting(true)}
                  data-testid="import-contacts"
                >
                  Import CSV
                </Button>
                <Button
                  size="sm"
                  onClick={() => void exportList()}
                  data-testid="export-contacts"
                >
                  Export CSV
                </Button>
              </div>

              <ContactTable
                listId={active.id}
                fields={active.fields}
                search={search}
                reloadKey={reloadKey}
                onDelete={(id) => void remove(id)}
              />
            </>
          )}
        </div>
      )}

      {creatingList && (
        <Dialog
          open
          onClose={() => setCreatingList(false)}
          title="Create New List"
          testId="create-list-dialog"
          footer={
            <>
              <Button onClick={() => setCreatingList(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => void createList()}
                data-testid="submit-list"
              >
                Create List
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="list-name" className="text-xs font-semibold text-ink">
                List Name
              </label>
              <input
                id="list-name"
                data-testid="list-name"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="e.g., Leads, Customers"
                className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="list-fields" className="text-xs font-semibold text-ink">
                Custom Fields (comma-separated)
              </label>
              <input
                id="list-fields"
                data-testid="list-fields"
                value={customFields}
                onChange={(e) => setCustomFields(e.target.value)}
                placeholder="e.g., Company, Status, Notes"
                className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
              />
              <p className="text-xs text-ink-subtle">
                Name and Mobile are always included. Custom fields become merge tags.
              </p>
            </div>
            {dialogError && (
              <p className="text-xs text-danger" role="alert" data-testid="list-error">
                {dialogError}
              </p>
            )}
          </div>
        </Dialog>
      )}

      {addingContact && active && (
        <Dialog
          open
          onClose={() => setAddingContact(false)}
          title="Add Contact"
          testId="add-contact-dialog"
          footer={
            <>
              <Button onClick={() => setAddingContact(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => void addContact()}
                data-testid="submit-contact"
              >
                Add Contact
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {active.fields.map((field) => (
              <div key={field} className="flex flex-col gap-1.5">
                <label
                  htmlFor={`field-${field}`}
                  className="text-xs font-semibold text-ink"
                >
                  {field}
                </label>
                <input
                  id={`field-${field}`}
                  data-testid={`field-${field}`}
                  value={newContact[field] ?? ''}
                  onChange={(e) =>
                    setNewContact((current) => ({ ...current, [field]: e.target.value }))
                  }
                  className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            ))}
            {dialogError && (
              <p className="text-xs text-danger" role="alert" data-testid="contact-error">
                {dialogError}
              </p>
            )}
          </div>
        </Dialog>
      )}

      {importing && active && (
        <ImportDialog
          listId={active.id}
          fields={active.fields}
          onClose={() => setImporting(false)}
          onImported={(summary) => {
            toast('success', summary)
            setReloadKey((k) => k + 1)
            lists.refetch()
          }}
        />
      )}
    </>
  )
}

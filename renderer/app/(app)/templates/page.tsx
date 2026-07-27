'use client'

import { FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@renderer/components/layout/page-header'
import { useToast } from '@renderer/components/providers/toast-provider'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { useIpcQuery } from '@renderer/hooks/useIpc'
import { extractTags, renderTemplate } from '@shared/merge-tags'
import { MAX_TEMPLATE_BUTTONS, type TemplateType } from '@shared/types'

const TYPE_LABEL: Record<TemplateType, string> = {
  text: 'Text Only',
  media: 'With Media (Image/Video)',
  interactive: 'Interactive Message',
  button: 'Button Message',
}

/** Types WhatsApp will not deliver as tappable UI — see REQUIREMENTS §7.9. */
const DEGRADES_TO_TEXT: TemplateType[] = ['button', 'interactive']

export default function TemplatesPage() {
  const templates = useIpcQuery('template:list')
  const lists = useIpcQuery('contactList:list')
  const toast = useToast()

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<TemplateType>('text')
  const [content, setContent] = useState('')
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image')
  const [mediaPath, setMediaPath] = useState('')
  const [options, setOptions] = useState('')
  const [buttons, setButtons] = useState('')
  const [error, setError] = useState<string>()

  // Every field across all lists is a candidate merge tag.
  const availableFields = useMemo(() => {
    const set = new Set<string>()
    for (const list of lists.data ?? []) for (const field of list.fields) set.add(field)
    return [...set]
  }, [lists.data])

  const sample = useMemo(() => {
    const values: Record<string, string> = {}
    for (const field of availableFields) values[field] = `«${field}»`
    values.Name = 'Priya'
    values.Mobile = '+919876543210'
    return values
  }, [availableFields])

  const preview = useMemo(() => renderTemplate(content, sample), [content, sample])
  const unknownTags = useMemo(
    () =>
      extractTags(content).filter(
        (tag) => !availableFields.some((f) => f.toLowerCase() === tag.toLowerCase()),
      ),
    [content, availableFields],
  )

  function reset() {
    setName('')
    setType('text')
    setContent('')
    setMediaPath('')
    setOptions('')
    setButtons('')
    setError(undefined)
  }

  function close() {
    setCreating(false)
    reset()
  }

  async function create() {
    setError(undefined)
    const buttonList = buttons
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b !== '')

    if (type === 'button' && buttonList.length > MAX_TEMPLATE_BUTTONS) {
      setError(`WhatsApp allows at most ${MAX_TEMPLATE_BUTTONS} buttons.`)
      return
    }

    const result = await window.api.invoke('template:create', {
      name,
      type,
      content,
      ...(type === 'media' ? { mediaType, mediaSourcePath: mediaPath.trim() } : {}),
      ...(type === 'interactive'
        ? {
            options: options
              .split('\n')
              .map((o) => o.trim())
              .filter((o) => o !== ''),
          }
        : {}),
      ...(type === 'button' ? { buttons: buttonList } : {}),
    })

    if (!result.ok) {
      setError(result.error.userMessage)
      return
    }
    close()
    templates.refetch()
    toast('success', 'Template created')
  }

  async function remove(id: string) {
    const result = await window.api.invoke('template:delete', { id })
    if (!result.ok) {
      toast('error', result.error.userMessage)
      return
    }
    templates.refetch()
  }

  const list = templates.data ?? []

  return (
    <>
      <PageHeader
        title="WhatsApp Templates"
        description="Reusable messages with media, buttons and merge tags."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="new-template">
            + New Template
          </Button>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates yet."
          description="Create a reusable message. Use {{Name}} to personalise it per recipient."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              + New Template
            </Button>
          }
        />
      ) : (
        <div
          className="grid gap-4 p-6 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]"
          data-testid="template-grid"
        >
          {list.map((template) => (
            <div
              key={template.id}
              data-testid="template-card"
              className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold text-ink">{template.name}</p>
                <span className="shrink-0 rounded bg-status-idle-bg px-2 py-0.5 text-xs text-status-idle-fg">
                  {TYPE_LABEL[template.type]}
                </span>
              </div>

              <div className="rounded-bubble bg-wa-out px-3 py-2 text-sm whitespace-pre-wrap text-ink">
                {template.type === 'media' && (
                  <div className="mb-1 rounded bg-black/5 px-2 py-4 text-center text-xs text-ink-muted">
                    [{(template.mediaType ?? 'image').toUpperCase()}]
                  </div>
                )}
                {template.content}
                {template.buttons && template.buttons.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {template.buttons.map((b, i) => (
                      <span key={b} className="rounded border border-black/10 px-2 py-1 text-xs">
                        {i + 1}. {b}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {DEGRADES_TO_TEXT.includes(template.type) && (
                <p className="text-xs text-status-warn-fg">
                  Sends as numbered text — WhatsApp does not accept tappable buttons from linked
                  devices.
                </p>
              )}

              <Button
                size="sm"
                variant="danger"
                className="self-start"
                onClick={() => void remove(template.id)}
                data-testid="delete-template"
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <Dialog
          open
          onClose={close}
          title="Create Template"
          testId="create-template-dialog"
          width={560}
          footer={
            <>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={() => void create()} data-testid="submit-template">
                Create Template
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tpl-name" className="text-xs font-semibold text-ink">
                Template Name
              </label>
              <input
                id="tpl-name"
                data-testid="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Welcome Message"
                className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="tpl-type" className="text-xs font-semibold text-ink">
                Template Type
              </label>
              <select
                id="tpl-type"
                data-testid="tpl-type"
                value={type}
                onChange={(e) => setType(e.target.value as TemplateType)}
                className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
              >
                {(Object.keys(TYPE_LABEL) as TemplateType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              {DEGRADES_TO_TEXT.includes(type) && (
                <p
                  className="rounded-card bg-status-warn-bg px-2 py-1.5 text-xs text-status-warn-fg"
                  data-testid="degrade-notice"
                >
                  WhatsApp no longer accepts tappable buttons from linked devices, so this sends as
                  numbered text. Recipients reply with a number.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="tpl-content" className="text-xs font-semibold text-ink">
                Message Content
              </label>
              <textarea
                id="tpl-content"
                data-testid="tpl-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Type your message..."
                className="min-h-24 resize-y rounded-control border border-line px-2.5 py-2 font-mono text-sm outline-none focus:border-primary"
              />
              {availableFields.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-ink-muted">Insert:</span>
                  {availableFields.map((field) => (
                    <button
                      key={field}
                      type="button"
                      data-testid={`insert-${field}`}
                      onClick={() => setContent((c) => `${c}{{${field}}}`)}
                      className="rounded border border-line px-1.5 py-0.5 text-xs text-ink hover:bg-wa-in"
                    >
                      {`{{${field}}}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {type === 'media' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tpl-media-type" className="text-xs font-semibold text-ink">
                    Media Type
                  </label>
                  <select
                    id="tpl-media-type"
                    data-testid="tpl-media-type"
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value as 'image' | 'video')}
                    className="rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tpl-media-path" className="text-xs font-semibold text-ink">
                    File path
                  </label>
                  <input
                    id="tpl-media-path"
                    data-testid="tpl-media-path"
                    value={mediaPath}
                    onChange={(e) => setMediaPath(e.target.value)}
                    placeholder="C:\Users\you\promo.png"
                    className="rounded-control border border-line px-2.5 py-2 font-mono text-xs outline-none focus:border-primary"
                  />
                  <p className="text-xs text-ink-subtle">
                    The file is copied into the app so it keeps working if you move the original.
                  </p>
                </div>
              </>
            )}

            {type === 'interactive' && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tpl-options" className="text-xs font-semibold text-ink">
                  Options (one per line)
                </label>
                <textarea
                  id="tpl-options"
                  data-testid="tpl-options"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  className="min-h-20 resize-y rounded-control border border-line px-2.5 py-2 font-mono text-sm outline-none focus:border-primary"
                />
              </div>
            )}

            {type === 'button' && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tpl-buttons" className="text-xs font-semibold text-ink">
                  Buttons (one per line, max {MAX_TEMPLATE_BUTTONS})
                </label>
                <textarea
                  id="tpl-buttons"
                  data-testid="tpl-buttons"
                  value={buttons}
                  onChange={(e) => setButtons(e.target.value)}
                  className="min-h-20 resize-y rounded-control border border-line px-2.5 py-2 font-mono text-sm outline-none focus:border-primary"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-ink">Preview</span>
              <div
                className="rounded-bubble bg-wa-out px-3 py-2 text-sm whitespace-pre-wrap text-ink"
                data-testid="tpl-preview"
              >
                {preview.text || (
                  <span className="text-ink-subtle">(Type a message to preview it)</span>
                )}
              </div>
              {unknownTags.length > 0 && (
                <p className="text-xs text-status-warn-fg" data-testid="unknown-tags">
                  No list provides: {unknownTags.map((t) => `{{${t}}}`).join(', ')}. These will send
                  as blanks.
                </p>
              )}
            </div>

            {error && (
              <p className="text-xs text-danger" role="alert" data-testid="template-error">
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}

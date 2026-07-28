'use client'

import { formatDistanceToNow } from 'date-fns'
import { MessageSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageHeader } from '@renderer/components/layout/page-header'
import { useToast } from '@renderer/components/providers/toast-provider'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { useIpcEvent, useIpcQuery } from '@renderer/hooks/useIpc'
import { cn } from '@renderer/lib/cn'
import type { MessageType } from '@shared/types'

interface Message {
  id: string
  direction: 'in' | 'out'
  type: MessageType
  body: string | null
  fileName: string | null
  fileSize: number | null
  buttons: string[] | null
  status: string
  timestamp: string
}

/** The prototype's emoji set (SPRINTS.md §2.2). */
const EMOJI = ['😊', '😂', '❤️', '👍', '🎉', '🔥', '💯', '✨', '😍', '🤔', '😢', '😡']

function fileSize(bytes: number | null): string {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

export default function InboxPage() {
  const devices = useIpcQuery('device:list')
  const [deviceFilter, setDeviceFilter] = useState('')
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [thread, setThread] = useState<{ chatId: string; messages: Message[] }>({
    chatId: '',
    messages: [],
  })
  const toast = useToast()

  const chats = useIpcQuery('chat:list', {
    ...(deviceFilter ? { deviceId: deviceFilter } : {}),
    ...(search ? { search } : {}),
    limit: 100,
  })

  const active = chats.data?.items.find((c) => c.id === activeId)
  const loaded = activeId !== undefined && thread.chatId === activeId

  // Load history when the selected chat changes. State is keyed by chatId so a
  // slow response for a previous chat cannot overwrite the current one.
  useEffect(() => {
    if (!activeId) return
    let cancelled = false

    void window.api.invoke('chat:messages', { chatId: activeId, limit: 100 }).then((result) => {
      if (cancelled) return
      // The channel returns newest-first for cursor paging; display is oldest-first.
      setThread({
        chatId: activeId,
        messages: result.ok ? [...result.data.items].reverse() : [],
      })
    })

    void window.api.invoke('chat:markRead', { chatId: activeId }).then(() => chats.refetch())

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Live ingestion: append to the open chat, and refresh the list either way so
  // ordering and unread badges stay correct.
  useIpcEvent('message:received', ({ chatId, message }) => {
    if (chatId === activeId) {
      setThread((current) =>
        current.chatId === chatId
          ? { ...current, messages: [...current.messages, message as Message] }
          : current,
      )
      void window.api.invoke('chat:markRead', { chatId })
    }
    chats.refetch()
  })

  useIpcEvent('message:status', ({ messageId, status }) => {
    setThread((current) => ({
      ...current,
      messages: current.messages.map((m) => (m.id === messageId ? { ...m, status } : m)),
    }))
  })

  async function send() {
    if (!activeId || draft.trim() === '') return
    const body = draft.trim()
    setDraft('')

    const result = await window.api.invoke('chat:send', { chatId: activeId, body })
    if (!result.ok) {
      toast('error', result.error.userMessage)
      // Give the text back rather than losing what the user typed.
      setDraft(body)
      return
    }
    setThread((current) => ({
      ...current,
      messages: [...current.messages, result.data as Message],
    }))
    chats.refetch()
  }

  const list = chats.data?.items ?? []

  if ((devices.data ?? []).length === 0) {
    return (
      <>
        <PageHeader
          title="Unified inbox"
          description="Conversations from every connected device."
        />
        <EmptyState
          icon={MessageSquare}
          title="No devices connected."
          description="Link a WhatsApp account and its conversations appear here."
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Unified inbox"
        description="Conversations from every connected device appear here."
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[300px] shrink-0 flex-col border-r border-line">
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats..."
              data-testid="chat-search"
              className="rounded-control border border-line px-2.5 py-1.5 text-sm outline-none focus:border-primary"
            />
            <select
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value)}
              data-testid="chat-device-filter"
              className="rounded-control border border-line px-2 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="">-- All Devices --</option>
              {(devices.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="chat-list">
            {list.length === 0 ? (
              <p className="p-4 text-xs text-ink-muted">No conversations yet.</p>
            ) : (
              list.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  data-testid="chat-item"
                  onClick={() => setActiveId(chat.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-line px-3 py-2 text-left',
                    chat.id === activeId ? 'bg-wa-in' : 'hover:bg-app-bg',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{chat.name}</span>
                    {chat.unreadCount > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-primary px-1.5 text-xs text-white"
                        data-testid="unread-badge"
                      >
                        {chat.unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-ink-muted">{chat.phone}</span>
                  <span className="truncate text-xs text-ink-subtle">{chat.lastMessage ?? ''}</span>
                  {chat.lastMessageAt && (
                    <span className="text-[10px] text-ink-subtle">
                      {formatDistanceToNow(new Date(chat.lastMessageAt))} ago
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {!active ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-ink-muted" data-testid="no-chat-selected">
                Select a chat
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink" data-testid="chat-name">
                    {active.name}
                  </p>
                  <p className="text-xs text-ink-muted">{active.phone}</p>
                </div>
                {active.isEscalated && (
                  <span className="rounded bg-status-warn-bg px-2 py-0.5 text-xs text-status-warn-fg">
                    Escalated
                  </span>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="message-thread">
                {loaded && thread.messages.length === 0 && (
                  <p className="text-center text-xs text-ink-muted">No messages yet.</p>
                )}
                {thread.messages.map((m) => (
                  <div
                    key={m.id}
                    data-testid="message-bubble"
                    className={cn(
                      'mb-2 flex',
                      m.direction === 'out' ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[70%] rounded-bubble px-3 py-2 text-sm',
                        m.direction === 'out' ? 'bg-wa-out text-ink' : 'bg-wa-in text-ink',
                        m.type === 'attachment' && 'border-l-4 border-wa-teal',
                      )}
                    >
                      {m.type === 'media' && (
                        <div className="mb-1 rounded bg-black/5 px-2 py-4 text-center text-xs text-ink-muted">
                          [MEDIA]
                        </div>
                      )}
                      {m.type === 'attachment' && (
                        <div className="mb-1 text-xs text-ink-muted">
                          📎 {m.fileName} {fileSize(m.fileSize)}
                        </div>
                      )}
                      {m.body && <span className="whitespace-pre-wrap">{m.body}</span>}
                      {m.buttons && m.buttons.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-1">
                          {m.buttons.map((b, i) => (
                            <span
                              key={b}
                              className="rounded border border-black/10 px-2 py-1 text-xs"
                            >
                              {i + 1}. {b}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className="mt-1 block text-right text-[10px] text-ink-subtle">
                        {new Date(m.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {m.direction === 'out' && ` · ${m.status}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-line p-3">
                {emojiOpen && (
                  <div className="mb-2 flex flex-wrap gap-1" data-testid="emoji-picker">
                    {EMOJI.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          setDraft((d) => d + e)
                          setEmojiOpen(false)
                        }}
                        className="rounded px-1.5 py-0.5 text-lg hover:bg-wa-in"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => setEmojiOpen((o) => !o)}
                    data-testid="emoji-toggle"
                  >
                    😊
                  </Button>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                    placeholder="Type a message..."
                    data-testid="message-input"
                    className="flex-1 rounded-control border border-line px-2.5 py-2 text-sm outline-none focus:border-primary"
                  />
                  <Button variant="primary" onClick={() => void send()} data-testid="send-message">
                    Send
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

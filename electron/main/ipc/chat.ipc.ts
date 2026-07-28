/**
 * Inbox channels.
 *
 * Messages are persisted by main as wa-service reports them, so the inbox
 * survives a restart and a wa-service crash. History is paged backwards rather
 * than loaded whole — a long-running account accumulates thousands of messages
 * per chat.
 */
import { AppError } from '../../../shared/errors'
import type { MessageType } from '../../../shared/types'
import { getPrisma } from '../db/client'
import { waBridge } from '../wa-bridge'
import { registerHandler } from './router'

function parseButtons(value: string | null): string[] | null {
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

function serializeMessage(row: {
  id: string
  chatId: string
  direction: string
  type: string
  body: string | null
  mediaPath: string | null
  fileName: string | null
  fileSize: number | null
  buttons: string | null
  status: string
  isAiReply: boolean
  timestamp: Date
}) {
  return {
    id: row.id,
    chatId: row.chatId,
    direction: row.direction as 'in' | 'out',
    type: row.type as MessageType,
    body: row.body,
    mediaPath: row.mediaPath,
    fileName: row.fileName,
    fileSize: row.fileSize,
    buttons: parseButtons(row.buttons),
    status: row.status as 'pending' | 'sent' | 'delivered' | 'read' | 'failed',
    isAiReply: row.isAiReply,
    timestamp: row.timestamp.toISOString(),
  }
}

function serializeChat(row: {
  id: string
  deviceId: string
  name: string
  phone: string
  isGroup: boolean
  lastMessage: string | null
  lastMessageAt: Date | null
  unreadCount: number
  isEscalated: boolean
}) {
  return {
    id: row.id,
    deviceId: row.deviceId,
    name: row.name,
    phone: row.phone,
    isGroup: row.isGroup,
    lastMessage: row.lastMessage,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    unreadCount: row.unreadCount,
    isEscalated: row.isEscalated,
  }
}

export function registerChatHandlers(): void {
  registerHandler('chat:list', async ({ deviceId, search, cursor, limit }) => {
    const where = {
      ...(deviceId ? { deviceId } : {}),
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
      getPrisma().chat.findMany({
        where,
        // Most recent first: an inbox sorted any other way is unusable.
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      getPrisma().chat.count({ where }),
    ])

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return {
      items: page.map(serializeChat),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      total,
    }
  })

  registerHandler('chat:get', async ({ id }) => {
    const chat = await getPrisma().chat.findUnique({ where: { id } })
    if (!chat)
      throw new AppError('NOT_FOUND', { userMessage: 'That chat no longer exists.' })
    return serializeChat(chat)
  })

  registerHandler('chat:messages', async ({ chatId, before, limit }) => {
    const where = {
      chatId,
      ...(before ? { timestamp: { lt: new Date(before) } } : {}),
    }

    const [rows, total] = await Promise.all([
      // Newest first so paging backwards is a simple `before` cursor; the UI
      // reverses for display.
      getPrisma().message.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit + 1,
      }),
      getPrisma().message.count({ where: { chatId } }),
    ])

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return {
      items: page.map(serializeMessage),
      nextCursor: hasMore
        ? (page[page.length - 1]?.timestamp.toISOString() ?? null)
        : null,
      total,
    }
  })

  registerHandler('chat:send', async ({ chatId, body, mediaSourcePath, buttons }) => {
    const chat = await getPrisma().chat.findUnique({ where: { id: chatId } })
    if (!chat)
      throw new AppError('NOT_FOUND', { userMessage: 'That chat no longer exists.' })

    if (!body && !mediaSourcePath) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Type a message first.' })
    }

    const message = mediaSourcePath
      ? ({ kind: 'media', path: mediaSourcePath, mediaType: 'image' as const } as const)
      : buttons && buttons.length > 0
        ? ({ kind: 'buttons', body: body ?? '', buttons } as const)
        : ({ kind: 'text', body: body ?? '' } as const)

    let messageId: string
    try {
      // Goes through wa-service, so the throttle applies here too — a reply
      // typed by hand is still traffic from the user's account.
      const result = await waBridge.request('message:send', {
        deviceId: chat.deviceId,
        to: chat.id,
        message,
      })
      messageId = result.messageId
    } catch (err) {
      throw new AppError('SEND_FAILED', {
        detail: err instanceof Error ? err.message : String(err),
      })
    }

    const saved = await getPrisma().message.create({
      data: {
        id: messageId,
        chatId,
        direction: 'out',
        type: mediaSourcePath ? 'media' : buttons?.length ? 'buttons' : 'text',
        body: body ?? null,
        mediaPath: mediaSourcePath ?? null,
        buttons: buttons?.length ? JSON.stringify(buttons) : null,
        status: 'sent',
        timestamp: new Date(),
      },
    })

    await getPrisma().chat.update({
      where: { id: chatId },
      data: { lastMessage: body ?? '[media]', lastMessageAt: new Date() },
    })

    return serializeMessage(saved)
  })

  registerHandler('chat:markRead', async ({ chatId }) => {
    await getPrisma().chat.update({ where: { id: chatId }, data: { unreadCount: 0 } })
    return { ok: true as const }
  })

  registerHandler('chat:setOptOut', async ({ chatId, optOut }) => {
    await getPrisma().chat.update({
      where: { id: chatId },
      data: { autoReplyOptOut: optOut },
    })
    return { ok: true as const }
  })
}

/**
 * Persist an inbound message and return it for broadcasting.
 *
 * Upserts the chat because a message can arrive from someone with no prior
 * conversation, and does nothing if the message id is already known — WhatsApp
 * can redeliver on reconnect, and a duplicate row would show the user the same
 * message twice.
 */
export async function persistIncoming(
  deviceId: string,
  incoming: {
    id: string
    chatId: string
    from: string
    pushName: string | null
    isGroup: boolean
    type: MessageType
    body: string | null
    fileName: string | null
    fileSize: number | null
    timestamp: string
  },
): Promise<ReturnType<typeof serializeMessage> | null> {
  const prisma = getPrisma()

  const existing = await prisma.message.findUnique({ where: { id: incoming.id } })
  if (existing) return null

  await prisma.chat.upsert({
    where: { id: incoming.chatId },
    create: {
      id: incoming.chatId,
      deviceId,
      name: incoming.pushName ?? incoming.from,
      phone: incoming.from,
      isGroup: incoming.isGroup,
      lastMessage: incoming.body,
      lastMessageAt: new Date(incoming.timestamp),
      unreadCount: 1,
    },
    update: {
      // A pushName can appear later than the first message.
      ...(incoming.pushName ? { name: incoming.pushName } : {}),
      lastMessage: incoming.body,
      lastMessageAt: new Date(incoming.timestamp),
      unreadCount: { increment: 1 },
    },
  })

  const saved = await prisma.message.create({
    data: {
      id: incoming.id,
      chatId: incoming.chatId,
      direction: 'in',
      type: incoming.type,
      body: incoming.body,
      fileName: incoming.fileName,
      fileSize: incoming.fileSize,
      status: 'delivered',
      timestamp: new Date(incoming.timestamp),
    },
  })

  return serializeMessage(saved)
}

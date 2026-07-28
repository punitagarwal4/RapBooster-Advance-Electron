/**
 * Real WhatsApp transport, wrapping Baileys.
 *
 * This is the only file in the codebase that imports Baileys. Everything else
 * talks to the Transport interface, so a version bump or API change is confined
 * here (CLAUDE.md §8).
 *
 * ⚠ BUTTON AND INTERACTIVE TEMPLATES ARE DEGRADED TO TEXT.
 * Baileys 7's send API (`AnyMessageContent`) has no button variant — the
 * protocol definitions only cover button *responses*, i.e. what arrives when a
 * recipient taps one. Sending buttons requires hand-assembling raw protobuf,
 * which WhatsApp breaks regularly and which raises ban risk on the user's
 * accounts. Rather than ship something that silently stops working, button and
 * interactive templates render their options as numbered text lines, which
 * always delivers. See REQUIREMENTS §7.9 for the decision to confirm.
 */
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from 'baileys'
import type { Boom } from '@hapi/boom'
import { readFile, rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { TransportEmitter } from './emitter'
import type {
  IncomingMessage,
  OutgoingMessage,
  RemoteGroup,
  SendResult,
  Transport,
} from './types'

interface Session {
  socket: WASocket
  authDir: string
  connected: boolean
  /** Set when logout() is called, so the close handler does not fight it. */
  closing: boolean
}

/** WhatsApp addresses individuals as <number>@s.whatsapp.net. */
function toJid(target: string): string {
  if (target.includes('@')) return target
  return `${target.replace(/\D/g, '')}@s.whatsapp.net`
}

function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return table[ext] ?? 'application/octet-stream'
}

export class BaileysTransport extends TransportEmitter implements Transport {
  private readonly sessions = new Map<string, Session>()

  async connect(deviceId: string, authDir: string): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(authDir)

    const socket = makeWASocket({
      auth: state,
      // Identifying as a desktop browser is what WhatsApp expects from a linked
      // device; the default can look anomalous.
      browser: Browsers.appropriate('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    })

    this.sessions.set(deviceId, { socket, authDir, connected: false, closing: false })
    this.emit('status', deviceId, 'connecting')

    // Credentials must be persisted the moment they change; a dropped update
    // means the user has to re-scan.
    socket.ev.on('creds.update', () => {
      void saveCreds()
    })

    socket.ev.on('connection.update', (update) => {
      const session = this.sessions.get(deviceId)
      if (!session) return

      if (update.qr) {
        this.emit('qr', deviceId, update.qr)
        this.emit('status', deviceId, 'qr_pending')
      }

      if (update.connection === 'open') {
        session.connected = true
        const phone = socket.user?.id?.split(':')[0]
        this.emit('status', deviceId, 'connected', phone ? { phone: `+${phone}` } : {})
      }

      if (update.connection === 'close') {
        session.connected = false
        const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode
        const loggedOut = statusCode === DisconnectReason.loggedOut

        // Only loggedOut is terminal. Everything else — restart required,
        // connection lost, timeout — is retryable, and the supervisor decides
        // when to retry (CLAUDE.md §5.4).
        if (loggedOut) {
          this.emit('status', deviceId, 'logged_out')
          this.emit(
            'disconnected',
            deviceId,
            'logged_out',
            `statusCode=${String(statusCode)}`,
          )
          this.sessions.delete(deviceId)
        } else if (!session.closing) {
          this.emit('status', deviceId, 'disconnected')
          this.emit(
            'disconnected',
            deviceId,
            'retryable',
            `statusCode=${String(statusCode)}`,
          )
        }
      }
    })

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return
      for (const raw of messages) {
        if (raw.key.fromMe) continue
        const parsed = this.parseIncoming(raw)
        if (parsed) this.emit('message', deviceId, parsed)
      }
    })

    socket.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        const status = update.update.status
        if (!update.key.id || status === undefined || status === null) continue
        // 3 = delivered, 4 = read in WhatsApp's status enum.
        if (Number(status) === 3)
          this.emit('receipt', deviceId, update.key.id, 'delivered')
        if (Number(status) === 4) this.emit('receipt', deviceId, update.key.id, 'read')
      }
    })
  }

  private parseIncoming(raw: WAMessage): IncomingMessage | null {
    const id = raw.key.id
    const chatId = raw.key.remoteJid
    if (!id || !chatId) return null

    const content = (raw.message ?? {}) as Record<string, unknown>
    const text =
      (content.conversation as string | undefined) ??
      (content.extendedTextMessage as { text?: string } | undefined)?.text ??
      null

    const image = content.imageMessage as { caption?: string } | undefined
    const video = content.videoMessage as { caption?: string } | undefined
    const document = content.documentMessage as
      { fileName?: string; fileLength?: number | Long; caption?: string } | undefined

    let type: IncomingMessage['type'] = 'text'
    let body = text
    let fileName: string | null = null
    let fileSize: number | null = null

    if (image ?? video) {
      type = 'media'
      body = image?.caption ?? video?.caption ?? null
    } else if (document) {
      type = 'attachment'
      body = document.caption ?? null
      fileName = document.fileName ?? null
      fileSize = document.fileLength ? Number(document.fileLength) : null
    } else if (content.buttonsResponseMessage ?? content.templateButtonReplyMessage) {
      type = 'buttons'
    } else if (content.listResponseMessage ?? content.interactiveResponseMessage) {
      type = 'interactive'
    }

    const seconds = raw.messageTimestamp
      ? Number(raw.messageTimestamp)
      : Date.now() / 1000

    return {
      id,
      chatId,
      from: chatId.split('@')[0] ?? chatId,
      pushName: raw.pushName ?? null,
      isGroup: chatId.endsWith('@g.us'),
      type,
      body,
      fileName,
      fileSize,
      timestamp: new Date(seconds * 1000).toISOString(),
    }
  }

  async requestPairingCode(deviceId: string, phone: string): Promise<string> {
    const session = this.sessions.get(deviceId)
    if (!session) throw new Error(`no session for device ${deviceId}`)

    this.emit('status', deviceId, 'pairing_pending')
    // Baileys wants digits only, including country code, without a leading '+'.
    const code = await session.socket.requestPairingCode(phone.replace(/\D/g, ''))
    this.emit('pairingCode', deviceId, code)
    return code
  }

  async disconnect(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId)
    if (!session) return
    session.closing = true
    session.socket.end(undefined)
    session.connected = false
    this.sessions.delete(deviceId)
    this.emit('status', deviceId, 'disconnected')
  }

  async logout(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId)
    if (!session) return
    session.closing = true
    try {
      await session.socket.logout()
    } catch (err) {
      // The socket may already be dead; the credentials still have to go.
      console.warn(`logout: socket.logout failed for ${deviceId}`, err)
    }
    this.sessions.delete(deviceId)
    // Credentials are useless after logout and must not be reused.
    await rm(session.authDir, { recursive: true, force: true })
    this.emit('status', deviceId, 'logged_out')
  }

  isConnected(deviceId: string): boolean {
    return this.sessions.get(deviceId)?.connected ?? false
  }

  async send(
    deviceId: string,
    to: string,
    message: OutgoingMessage,
  ): Promise<SendResult> {
    const session = this.sessions.get(deviceId)
    if (!session?.connected) {
      throw new Error(`device ${deviceId} is not connected`)
    }

    const jid = toJid(to)
    const sent = await session.socket.sendMessage(jid, await this.toContent(message))
    const id = sent?.key?.id
    if (!id) throw new Error('send returned no message id')
    return { messageId: id }
  }

  /** Map our outgoing shapes onto Baileys' AnyMessageContent. */
  private async toContent(message: OutgoingMessage) {
    switch (message.kind) {
      case 'text':
        return { text: message.body }

      case 'media': {
        const buffer = await readFile(message.path)
        return message.mediaType === 'video'
          ? { video: buffer, ...(message.caption ? { caption: message.caption } : {}) }
          : { image: buffer, ...(message.caption ? { caption: message.caption } : {}) }
      }

      case 'document': {
        const buffer = await readFile(message.path)
        return {
          document: buffer,
          fileName: message.fileName || basename(message.path),
          mimetype: mimeFor(message.path),
          ...(message.caption ? { caption: message.caption } : {}),
        }
      }

      case 'buttons': {
        // See the file header: Baileys 7 cannot send real buttons. Numbered
        // text always delivers, which is better than a message that silently
        // fails to render on the recipient's phone.
        const options = message.buttons.map((label, i) => `${i + 1}. ${label}`).join('\n')
        return { text: `${message.body}\n\n${options}` }
      }
    }
  }

  async fetchGroups(deviceId: string): Promise<RemoteGroup[]> {
    const session = this.sessions.get(deviceId)
    if (!session?.connected) throw new Error(`device ${deviceId} is not connected`)

    const own = session.socket.user?.id?.split(':')[0]
    const all = await session.socket.groupFetchAllParticipating()

    return Object.values(all).map((group) => ({
      id: group.id,
      name: group.subject,
      memberCount: group.participants.length,
      isAdmin: group.participants.some(
        (p) =>
          p.id.startsWith(own ?? ' ') && (p.admin === 'admin' || p.admin === 'superadmin'),
      ),
    }))
  }

  async createGroup(
    deviceId: string,
    subject: string,
    participants: string[],
  ): Promise<RemoteGroup> {
    const session = this.sessions.get(deviceId)
    if (!session?.connected) throw new Error(`device ${deviceId} is not connected`)

    const created = await session.socket.groupCreate(subject, participants.map(toJid))
    return {
      id: created.id,
      name: created.subject,
      memberCount: created.participants.length,
      isAdmin: true,
    }
  }

  async shutdown(): Promise<void> {
    for (const [deviceId] of this.sessions) {
      await this.disconnect(deviceId)
    }
  }
}

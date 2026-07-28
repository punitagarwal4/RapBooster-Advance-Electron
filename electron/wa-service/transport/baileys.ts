/**
 * Real WhatsApp transport, wrapping Baileys.
 *
 * This is the only file in the codebase that imports Baileys. Everything else
 * talks to the Transport interface, so a version bump or API change is confined
 * here (CLAUDE.md §8).
 *
 * BUTTONS AND LISTS (REQUIREMENTS §7.9).
 * Baileys 7's high-level `sendMessage` content union has no button variant —
 * only button *responses*, i.e. what arrives when a recipient taps one. The
 * protobuf definitions for sending are all still present, so real buttons go out
 * through `generateWAMessageFromContent` + `relayMessage` instead (see
 * `sendInteractive` below). Whether a given account's recipients see them
 * rendered is decided by WhatsApp's servers, not by us, so every interactive
 * send falls back to numbered text if construction or relay fails — a message
 * that always arrives beats one that silently does not.
 */
import makeWASocket, {
  Browsers,
  DisconnectReason,
  generateWAMessageFromContent,
  jidNormalizedUser,
  proto,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from 'baileys'
import type { Boom } from '@hapi/boom'
import { rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { TransportEmitter } from './emitter'
import { resolveLinkPreview } from '../link-preview'
import { buttonsAsNumberedText } from '../../../shared/template-buttons'
import type { WaButton } from '../../../shared/wa-protocol'
import type {
  IncomingMessage,
  OutgoingButtons,
  OutgoingList,
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

/**
 * Buttons, in the most widely-rendered shape that can carry them.
 *
 * - Quick replies only → `buttonsMessage`, the oldest and best-supported form.
 * - Reply/url/call mix → `templateMessage.hydratedTemplate`, whose three button
 *   kinds map exactly onto ours.
 * - Anything with a copy button → `interactiveMessage.nativeFlowMessage`, the
 *   only shape that carries one.
 *
 * Each step down is less widely rendered, so we take the highest one that can
 * express the template rather than always using the most capable.
 */
function buildButtonsMessage(message: OutgoingButtons): proto.IMessage {
  const { body, footer, buttons } = message

  if (buttons.some((b) => b.type === 'copy')) {
    return {
      // viewOnce is how WhatsApp Web itself wraps native-flow messages; without
      // it many clients ignore the buttons entirely.
      viewOnceMessage: {
        message: {
          messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
          interactiveMessage: {
            body: { text: body },
            ...(footer ? { footer: { text: footer } } : {}),
            nativeFlowMessage: {
              messageVersion: 1,
              buttons: buttons.map(nativeFlowButton),
            },
          },
        },
      },
    }
  }

  if (buttons.every((b) => b.type === 'reply')) {
    return {
      buttonsMessage: {
        contentText: body,
        ...(footer ? { footerText: footer } : {}),
        headerType: proto.Message.ButtonsMessage.HeaderType.EMPTY,
        buttons: buttons.map((b) => ({
          buttonId: b.id,
          buttonText: { displayText: b.label },
          type: proto.Message.ButtonsMessage.Button.Type.RESPONSE,
        })),
      },
    }
  }

  return {
    templateMessage: {
      hydratedTemplate: {
        hydratedContentText: body,
        ...(footer ? { hydratedFooterText: footer } : {}),
        hydratedButtons: buttons.map((b, index) => hydratedButton(b, index + 1)),
      },
    },
  }
}

function hydratedButton(button: WaButton, index: number): proto.IHydratedTemplateButton {
  switch (button.type) {
    case 'url':
      return {
        index,
        urlButton: { displayText: button.label, url: button.value ?? '' },
      }
    case 'call':
      return {
        index,
        callButton: { displayText: button.label, phoneNumber: button.value ?? '' },
      }
    // A copy button never reaches here — buildButtonsMessage routes those to
    // native flow, which is the only shape that can express one.
    case 'reply':
    case 'copy':
      return {
        index,
        quickReplyButton: { displayText: button.label, id: button.id },
      }
  }
}

/**
 * Native-flow buttons are `{ name, buttonParamsJson }` pairs. Baileys neither
 * validates the name nor parses the JSON — the names below are WhatsApp's own,
 * and an unknown one is dropped by the server, which is why the caller keeps a
 * text fallback.
 */
function nativeFlowButton(button: WaButton) {
  switch (button.type) {
    case 'url':
      return {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: button.label,
          url: button.value ?? '',
          merchant_url: button.value ?? '',
        }),
      }
    case 'call':
      return {
        name: 'cta_call',
        buttonParamsJson: JSON.stringify({
          display_text: button.label,
          phone_number: button.value ?? '',
        }),
      }
    case 'copy':
      return {
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({
          display_text: button.label,
          copy_code: button.value ?? '',
        }),
      }
    case 'reply':
      return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: button.label, id: button.id }),
      }
  }
}

/** A single-select list. WhatsApp renders one section; more adds no value here. */
function buildListMessage(message: OutgoingList): proto.IMessage {
  return {
    listMessage: {
      description: message.body,
      buttonText: message.buttonText,
      ...(message.footer ? { footerText: message.footer } : {}),
      listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
      sections: [
        {
          rows: message.rows.map((row) => ({
            rowId: row.id,
            title: row.title,
            ...(row.description ? { description: row.description } : {}),
          })),
        },
      ],
    },
  }
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

    if (message.kind === 'buttons' || message.kind === 'list') {
      const interactive = await this.sendInteractive(session.socket, jid, message)
      if (interactive) return interactive
      // Fell back: send the text form through the normal path below.
    }

    const sent = await session.socket.sendMessage(jid, await this.toContent(message))
    const id = sent?.key?.id
    if (!id) throw new Error('send returned no message id')
    return { messageId: id }
  }

  /**
   * Send a real buttons/list message by building the protobuf directly.
   *
   * Returns null when the message could not be built or relayed, which makes the
   * caller fall back to numbered text. WHY a fallback at all: WhatsApp decides
   * server-side whether an unofficial client may send these, and that answer has
   * changed before. A campaign that stops delivering is far worse than one whose
   * buttons arrive as a numbered list.
   */
  private async sendInteractive(
    socket: WASocket,
    jid: string,
    message: OutgoingButtons | OutgoingList,
  ): Promise<SendResult | null> {
    try {
      const content =
        message.kind === 'list' ? buildListMessage(message) : buildButtonsMessage(message)

      const generated = generateWAMessageFromContent(jid, content, {
        userJid: socket.user?.id ?? '',
      })
      const id = generated.key?.id
      if (!id) return null

      await socket.relayMessage(jid, generated.message ?? {}, { messageId: id })
      return { messageId: id }
    } catch (err) {
      // Not silent: this is the signal that WhatsApp changed the rules, and the
      // user is still getting their message — as text.
      console.warn('interactive send failed, falling back to text', err)
      return null
    }
  }

  /** Map our outgoing shapes onto Baileys' AnyMessageContent. */
  private async toContent(message: OutgoingMessage) {
    switch (message.kind) {
      // Link previews are on for every text message (REQUIREMENTS §7.11). The
      // preview is resolved here and handed over finished, so Baileys does not
      // fetch it again per recipient — see ../link-preview.ts. An explicit null
      // is what tells Baileys "no preview, and do not go looking".
      case 'text':
        return { text: message.body, linkPreview: await resolveLinkPreview(message.body) }

      // NOTE: pass `{ url: path }` rather than a Buffer so Baileys streams the
      // file from disk. Reading it into memory first costs roughly twice the
      // file size (the buffer, plus the encryption stream Baileys builds from
      // it) and that cost is paid per in-flight send. Measured on a 15 MB
      // video: 30.9 MB peak buffered vs 11.8 MB streamed. Across 20 devices
      // that is ~618 MB against ~236 MB, and the buffered figure breaks the
      // 800 MB budget in CLAUDE.md §5.7 on its own. The produced message is
      // byte-identical either way — same thumbnail, dimensions and fileLength.
      case 'media': {
        const source = { url: message.path }
        return message.mediaType === 'video'
          ? { video: source, ...(message.caption ? { caption: message.caption } : {}) }
          : { image: source, ...(message.caption ? { caption: message.caption } : {}) }
      }

      case 'document': {
        return {
          document: { url: message.path },
          fileName: message.fileName || basename(message.path),
          mimetype: mimeFor(message.path),
          ...(message.caption ? { caption: message.caption } : {}),
        }
      }

      // Only reached when the interactive send above could not be delivered.
      case 'buttons': {
        const text = buttonsAsNumberedText(message.body, message.buttons)
        const body = message.footer ? `${text}\n\n${message.footer}` : text
        return { text: body, linkPreview: await resolveLinkPreview(body) }
      }

      case 'list': {
        const rows = message.rows
          .map(
            (row, i) =>
              `${i + 1}. ${row.title}${row.description ? ` — ${row.description}` : ''}`,
          )
          .join('\n')
        const text = `${message.body}\n\n${rows}`
        const body = message.footer ? `${text}\n\n${message.footer}` : text
        return { text: body, linkPreview: await resolveLinkPreview(body) }
      }
    }
  }

  async fetchGroups(deviceId: string): Promise<RemoteGroup[]> {
    const session = this.sessions.get(deviceId)
    if (!session?.connected) throw new Error(`device ${deviceId} is not connected`)

    // NOTE: compare normalized JIDs, not string prefixes. Baileys reports our
    // own id with a device suffix (`<user>:<device>@s.whatsapp.net`) while group
    // participants carry none, so the two are only comparable after
    // normalization. A previous version used `p.id.startsWith(own)`, which also
    // matched any participant whose number merely *begins* with ours — a member
    // on +9198765432100 would have been read as us on +919876543210, silently
    // reporting the wrong admin rights for that group.
    const own = session.socket.user?.id ? jidNormalizedUser(session.socket.user.id) : null
    const all = await session.socket.groupFetchAllParticipating()

    return Object.values(all).map((group) => ({
      id: group.id,
      name: group.subject,
      memberCount: group.participants.length,
      // Unknown own id means we cannot claim admin — never assume we can.
      isAdmin:
        own !== null &&
        group.participants.some(
          (p) =>
            jidNormalizedUser(p.id) === own &&
            (p.admin === 'admin' || p.admin === 'superadmin'),
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

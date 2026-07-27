/**
 * The WhatsApp transport contract.
 *
 * WHY this interface exists: Baileys is the most security-sensitive and most
 * volatile dependency in the app, currently pinned to a release candidate. Every
 * caller — session manager, campaign worker, group runner, auto-reply worker —
 * talks to this interface instead, so a Baileys upgrade or API change touches
 * exactly one implementation file.
 *
 * It is also what makes the whole system testable. The mock implementation
 * satisfies this contract deterministically, so Sprints 3 and 4 can be tested in
 * CI without a real WhatsApp account — and a ban on a real account is
 * unrecoverable (CLAUDE.md §5.4).
 */
import type { DeviceStatus } from '../../../shared/types'

export interface OutgoingText {
  kind: 'text'
  body: string
}

export interface OutgoingMedia {
  kind: 'media'
  /** Absolute path inside the app's managed media store. */
  path: string
  mediaType: 'image' | 'video'
  caption?: string
}

export interface OutgoingDocument {
  kind: 'document'
  path: string
  fileName: string
  caption?: string
}

export interface OutgoingButtons {
  kind: 'buttons'
  body: string
  /** WhatsApp permits at most three quick replies. */
  buttons: string[]
}

export type OutgoingMessage =
  | OutgoingText
  | OutgoingMedia
  | OutgoingDocument
  | OutgoingButtons

export interface SendResult {
  messageId: string
}

export interface IncomingMessage {
  id: string
  chatId: string
  from: string
  pushName: string | null
  isGroup: boolean
  type: 'text' | 'media' | 'attachment' | 'buttons' | 'interactive'
  body: string | null
  fileName: string | null
  fileSize: number | null
  timestamp: string
}

export interface RemoteGroup {
  id: string
  name: string
  memberCount: number
  isAdmin: boolean
}

/** Reason a connection closed, normalized away from Baileys' status codes. */
export type DisconnectKind = 'retryable' | 'logged_out'

export interface TransportEvents {
  status: (deviceId: string, status: DeviceStatus, detail?: { phone?: string; error?: string }) => void
  qr: (deviceId: string, qr: string) => void
  pairingCode: (deviceId: string, code: string) => void
  message: (deviceId: string, message: IncomingMessage) => void
  /** Delivery/read receipt for a message we sent. */
  receipt: (deviceId: string, messageId: string, status: 'delivered' | 'read') => void
  disconnected: (deviceId: string, kind: DisconnectKind, detail: string) => void
}

export interface Transport {
  /**
   * Open a session. Resolves once the socket is created — not once connected;
   * connection progress arrives through the `status` event.
   */
  connect(deviceId: string, authDir: string): Promise<void>
  /** Request an 8-digit pairing code instead of a QR scan. */
  requestPairingCode(deviceId: string, phone: string): Promise<string>
  /** Close the socket but keep credentials, so it can reconnect later. */
  disconnect(deviceId: string): Promise<void>
  /** Close and invalidate credentials — the device must be re-linked. */
  logout(deviceId: string): Promise<void>
  isConnected(deviceId: string): boolean
  send(deviceId: string, to: string, message: OutgoingMessage): Promise<SendResult>
  fetchGroups(deviceId: string): Promise<RemoteGroup[]>
  createGroup(deviceId: string, subject: string, participants: string[]): Promise<RemoteGroup>
  /** Close every socket; called on app quit. */
  shutdown(): Promise<void>
  on<E extends keyof TransportEvents>(event: E, handler: TransportEvents[E]): void
}

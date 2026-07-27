/**
 * Protocol between main and the `wa-service` utility process.
 *
 * Mirrors the IPC contract's discipline: typed requests, typed events, and no
 * throwing across the boundary — a rejected promise loses its shape when it
 * crosses a MessagePort, so failures come back as a discriminated result.
 *
 * WHY a separate process at all (CLAUDE.md §2.3): twenty concurrent Baileys
 * sockets run continuous Signal-protocol crypto and emit a high volume of
 * events. In main that would stall window management and IPC. Isolation also
 * means a Baileys crash restarts one process instead of killing the app.
 *
 * `wa-service` never touches SQLite. It reports outcomes and main persists them,
 * so there is exactly one database writer (CLAUDE.md §2.4).
 */
import type { DeviceStatus } from './types'

// ─────────────────────────────── requests ────────────────────────────────

export interface WaRequests {
  'device:connect': { deviceId: string; authDir: string }
  'device:pairingCode': { deviceId: string; phone: string }
  'device:disconnect': { deviceId: string }
  'device:logout': { deviceId: string }
  'device:isConnected': { deviceId: string }
  'group:fetch': { deviceId: string }
  'group:create': { deviceId: string; subject: string; participants: string[] }
  'message:send': {
    deviceId: string
    to: string
    message: WaOutgoing
  }
  'service:ping': Record<string, never>
  'service:shutdown': Record<string, never>
}

export type WaOutgoing =
  | { kind: 'text'; body: string }
  | { kind: 'media'; path: string; mediaType: 'image' | 'video'; caption?: string }
  | { kind: 'document'; path: string; fileName: string; caption?: string }
  | { kind: 'buttons'; body: string; buttons: string[] }

export interface WaResponses {
  'device:connect': { started: true }
  'device:pairingCode': { code: string }
  'device:disconnect': { ok: true }
  'device:logout': { ok: true }
  'device:isConnected': { connected: boolean }
  'group:fetch': {
    groups: Array<{ id: string; name: string; memberCount: number; isAdmin: boolean }>
  }
  'group:create': { id: string; name: string; memberCount: number; isAdmin: boolean }
  'message:send': { messageId: string }
  'service:ping': { pong: true; sessions: number }
  'service:shutdown': { ok: true }
}

export type WaRequestKind = keyof WaRequests

export interface WaRequestEnvelope<K extends WaRequestKind = WaRequestKind> {
  id: number
  kind: K
  payload: WaRequests[K]
}

export type WaResult<K extends WaRequestKind> =
  | { ok: true; data: WaResponses[K] }
  | { ok: false; error: string }

export interface WaResponseEnvelope<K extends WaRequestKind = WaRequestKind> {
  id: number
  result: WaResult<K>
}

// ──────────────────────────────── events ─────────────────────────────────

export interface WaEvents {
  status: { deviceId: string; status: DeviceStatus; phone?: string; error?: string }
  qr: { deviceId: string; qr: string }
  pairingCode: { deviceId: string; code: string }
  message: {
    deviceId: string
    message: {
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
  }
  receipt: { deviceId: string; messageId: string; status: 'delivered' | 'read' }
  /** Emitted after the reconnect budget is exhausted, so main can inform the user. */
  giveUp: { deviceId: string; attempts: number; detail: string }
  log: { level: 'info' | 'warn' | 'error'; message: string }
}

export type WaEventKind = keyof WaEvents

export interface WaEventEnvelope<K extends WaEventKind = WaEventKind> {
  event: K
  payload: WaEvents[K]
}

export type WaMessage = WaResponseEnvelope | WaEventEnvelope

export function isEventEnvelope(message: WaMessage): message is WaEventEnvelope {
  return 'event' in message
}

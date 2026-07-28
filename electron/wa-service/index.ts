/**
 * `wa-service` entry point.
 *
 * Runs as an Electron utilityProcess. Owns every WhatsApp socket and nothing
 * else — no database handle, no window, no license state. It receives typed
 * requests over the parent port and answers with a discriminated result;
 * unsolicited state changes go back as events.
 */
import { MockTransport } from './transport/mock'
import { SessionManager } from './session-manager'
import { ThrottleScheduler } from './throttle'
import type { Transport } from './transport/types'
import type {
  WaEventEnvelope,
  WaEventKind,
  WaEvents,
  WaRequestEnvelope,
  WaRequestKind,
  WaResponseEnvelope,
  WaResponses,
} from '../../shared/wa-protocol'

/**
 * The mock is selected by env so tests never reach the network. Baileys is
 * imported lazily precisely so the mock path does not pay for loading it — and
 * so a Baileys import failure cannot break the test transport.
 */
async function createTransport(): Promise<Transport> {
  if (process.env.WA_TRANSPORT === 'mock') {
    return new MockTransport()
  }
  const { BaileysTransport } = await import('./transport/baileys')
  return new BaileysTransport()
}

function post(message: WaResponseEnvelope | WaEventEnvelope): void {
  process.parentPort?.postMessage(message)
}

function emit<K extends WaEventKind>(event: K, payload: WaEvents[K]): void {
  post({ event, payload } as WaEventEnvelope)
}

async function main(): Promise<void> {
  const transport = await createTransport()
  const throttle = new ThrottleScheduler()

  const sessions = new SessionManager(transport, {
    onStatus: (deviceId, status, detail) =>
      emit('status', { deviceId, status, ...(detail ?? {}) }),
    onGiveUp: (deviceId, attempts, detail) =>
      emit('giveUp', { deviceId, attempts, detail }),
    onLog: (level, message) => emit('log', { level, message }),
  })

  // Forward transport events straight through; main decides what to persist.
  transport.on('status', (deviceId, status, detail) => {
    if (status === 'connected') sessions.noteConnected(deviceId)
    emit('status', { deviceId, status, ...(detail ?? {}) })
  })
  transport.on('qr', (deviceId, qr) => emit('qr', { deviceId, qr }))
  transport.on('pairingCode', (deviceId, code) => emit('pairingCode', { deviceId, code }))
  transport.on('message', (deviceId, message) => emit('message', { deviceId, message }))
  transport.on('receipt', (deviceId, messageId, status) =>
    emit('receipt', { deviceId, messageId, status }),
  )

  async function handle<K extends WaRequestKind>(
    envelope: WaRequestEnvelope<K>,
  ): Promise<WaResponses[K]> {
    const { kind, payload } = envelope

    switch (kind) {
      case 'device:connect': {
        const p = payload as WaRequestEnvelope<'device:connect'>['payload']
        await sessions.connect(p.deviceId, p.authDir)
        return { started: true } as WaResponses[K]
      }
      case 'device:pairingCode': {
        const p = payload as WaRequestEnvelope<'device:pairingCode'>['payload']
        const code = await transport.requestPairingCode(p.deviceId, p.phone)
        return { code } as WaResponses[K]
      }
      case 'device:disconnect': {
        const p = payload as WaRequestEnvelope<'device:disconnect'>['payload']
        await sessions.disconnect(p.deviceId)
        return { ok: true } as WaResponses[K]
      }
      case 'device:logout': {
        const p = payload as WaRequestEnvelope<'device:logout'>['payload']
        await sessions.logout(p.deviceId)
        return { ok: true } as WaResponses[K]
      }
      case 'device:isConnected': {
        const p = payload as WaRequestEnvelope<'device:isConnected'>['payload']
        return { connected: transport.isConnected(p.deviceId) } as WaResponses[K]
      }
      case 'group:fetch': {
        const p = payload as WaRequestEnvelope<'group:fetch'>['payload']
        return { groups: await transport.fetchGroups(p.deviceId) } as WaResponses[K]
      }
      case 'group:create': {
        const p = payload as WaRequestEnvelope<'group:create'>['payload']
        return (await transport.createGroup(
          p.deviceId,
          p.subject,
          p.participants,
        )) as WaResponses[K]
      }
      case 'message:send': {
        const p = payload as WaRequestEnvelope<'message:send'>['payload']
        // Every outbound message goes through the scheduler. This is the last
        // gate before the socket, so no caller can bypass pacing.
        return (await throttle.run(p.deviceId, () =>
          transport.send(p.deviceId, p.to, p.message),
        )) as WaResponses[K]
      }
      case 'throttle:configure': {
        const p = payload as WaRequestEnvelope<'throttle:configure'>['payload']
        const { deviceId, sentToday, ...config } = p
        const defined = Object.fromEntries(
          Object.entries(config).filter(([, v]) => v !== undefined),
        )
        throttle.configure(deviceId, defined)
        if (sentToday !== undefined) throttle.seed(deviceId, sentToday)
        return { ok: true } as WaResponses[K]
      }
      case 'service:ping':
        return { pong: true, sessions: sessions.sessionCount } as WaResponses[K]
      case 'service:shutdown':
        await sessions.shutdown()
        return { ok: true } as WaResponses[K]
      default: {
        // Exhaustiveness: adding a request kind without a case is a type error.
        const never: never = kind
        throw new Error(`unknown request kind: ${String(never)}`)
      }
    }
  }

  process.parentPort?.on('message', (event) => {
    const envelope = event.data as WaRequestEnvelope
    void handle(envelope)
      .then((data) => post({ id: envelope.id, result: { ok: true, data } }))
      .catch((err: unknown) => {
        // Never throw across the port: a rejected promise loses its shape and
        // the caller would hang waiting for a reply that never arrives.
        post({
          id: envelope.id,
          result: { ok: false, error: err instanceof Error ? err.message : String(err) },
        })
      })
  })

  emit('log', {
    level: 'info',
    message: `wa-service ready (${process.env.WA_TRANSPORT ?? 'baileys'})`,
  })
}

process.on('uncaughtException', (err) => {
  emit('log', { level: 'error', message: `uncaughtException: ${err.message}` })
})
process.on('unhandledRejection', (reason) => {
  emit('log', { level: 'error', message: `unhandledRejection: ${String(reason)}` })
})

void main().catch((err: unknown) => {
  emit('log', { level: 'error', message: `wa-service failed to start: ${String(err)}` })
  process.exit(1)
})

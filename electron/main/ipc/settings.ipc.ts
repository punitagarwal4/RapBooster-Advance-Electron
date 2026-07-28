/**
 * Settings channels.
 *
 * Encrypted values are write-only from the renderer's point of view: they can
 * be set, and the app can tell you whether one is set, but `settings:get` never
 * hands a secret back. A key that can be read out of the UI is a key that ends
 * up in a screenshot, a support bundle, or a bug report.
 */
import { AppError } from '../../../shared/errors'
import { getPrisma } from '../db/client'
import { encryptValue } from '../services/secure-store'
import { registerHandler } from './router'

/** Keys whose values must never be returned to the renderer. */
const SECRET_KEY = /key|token|secret|password/i

const SENDING_DEFAULTS = {
  'sending.delayFrom': 0,
  'sending.delayTo': 5,
  'sending.sleepDuration': 10,
  'sending.sleepAfter': 10,
  'sending.groupMessageDelay': 2,
  'sending.groupCreateDelay': 2,
  'sending.dailyCapPerDevice': 0,
  'sending.retryAttempts': 2,
  'sending.maxConcurrentDevices': 20,
} as const

async function readNumber(key: keyof typeof SENDING_DEFAULTS): Promise<number> {
  const row = await getPrisma().setting.findUnique({ where: { key } })
  const parsed = row ? Number(row.value) : NaN
  return Number.isFinite(parsed) ? parsed : SENDING_DEFAULTS[key]
}

/**
 * The configured per-device daily send cap, or 0 for unlimited.
 *
 * Exported because the campaign engine has to push this into the wa-service
 * throttle. It previously read nowhere: the setting was saved and shown in the
 * UI, and the throttle supported a `dailyCap`, but nothing ever carried the
 * value between them — so the cap silently did nothing at all.
 */
export async function dailyCapPerDevice(): Promise<number> {
  return readNumber('sending.dailyCapPerDevice')
}

export function registerSettingsHandlers(): void {
  registerHandler('settings:get', async ({ key }) => {
    const row = await getPrisma().setting.findUnique({ where: { key } })
    if (!row) return { value: null }

    // Never return a secret, even encrypted — the renderer has no legitimate
    // use for it, and the only thing it could do is leak it.
    if (row.isEncrypted || SECRET_KEY.test(key)) {
      return { value: row.value.length > 0 ? '••••••••' : null }
    }
    return { value: row.value }
  })

  registerHandler('settings:set', async ({ key, value, encrypt }) => {
    const shouldEncrypt = encrypt || SECRET_KEY.test(key)

    // Record what actually happened, not what was intended. When the OS keychain
    // is unavailable `encryptValue` falls back to storing the value in the clear,
    // and writing `isEncrypted: shouldEncrypt` claimed it was encrypted anyway —
    // so the database asserted a protection the value did not have, and nothing
    // could tell the difference afterwards.
    const result = shouldEncrypt
      ? encryptValue(value)
      : { data: value, encrypted: false as const }

    await getPrisma().setting.upsert({
      where: { key },
      create: { key, value: result.data, isEncrypted: result.encrypted },
      update: { value: result.data, isEncrypted: result.encrypted },
    })

    // The renderer needs this to warn the user. CLAUDE.md §5.6 requires an
    // explicit degrade rather than silent plaintext, and a secret stored in the
    // clear is something the user must be able to act on.
    return {
      ok: true as const,
      encrypted: result.encrypted,
      wantedEncryption: shouldEncrypt,
    }
  })

  registerHandler('settings:getSendingDefaults', async () => ({
    delayFrom: await readNumber('sending.delayFrom'),
    delayTo: await readNumber('sending.delayTo'),
    sleepDuration: await readNumber('sending.sleepDuration'),
    sleepAfter: await readNumber('sending.sleepAfter'),
    groupMessageDelay: await readNumber('sending.groupMessageDelay'),
    groupCreateDelay: await readNumber('sending.groupCreateDelay'),
    dailyCapPerDevice: await readNumber('sending.dailyCapPerDevice'),
    retryAttempts: await readNumber('sending.retryAttempts'),
    maxConcurrentDevices: await readNumber('sending.maxConcurrentDevices'),
  }))

  registerHandler('settings:setSendingDefaults', async (input) => {
    if (input.delayFrom > input.delayTo) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'The delay range starts after it ends — swap the two values.',
      })
    }

    const entries: Array<[keyof typeof SENDING_DEFAULTS, number]> = [
      ['sending.delayFrom', input.delayFrom],
      ['sending.delayTo', input.delayTo],
      ['sending.sleepDuration', input.sleepDuration],
      ['sending.sleepAfter', input.sleepAfter],
      ['sending.groupMessageDelay', input.groupMessageDelay],
      ['sending.groupCreateDelay', input.groupCreateDelay],
      ['sending.dailyCapPerDevice', input.dailyCapPerDevice],
      ['sending.retryAttempts', input.retryAttempts],
      ['sending.maxConcurrentDevices', input.maxConcurrentDevices],
    ]

    await getPrisma().$transaction(
      entries.map(([key, value]) =>
        getPrisma().setting.upsert({
          where: { key },
          create: { key, value: String(value), isEncrypted: false },
          update: { value: String(value) },
        }),
      ),
    )

    return input
  })
}

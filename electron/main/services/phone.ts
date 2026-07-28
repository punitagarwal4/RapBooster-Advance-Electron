/**
 * Phone normalization to E.164.
 *
 * Numbers are normalized at import and **stored** normalized, because the send
 * path needs a canonical form and re-deriving it per send would be both slower
 * and inconsistent.
 *
 * WHY there is no default country: guessing one is unrecoverable at scale. A
 * 50,000-row list normalized against the wrong country produces 50,000 valid
 * looking numbers that reach the wrong people, and the only fix is a re-import.
 * The importer therefore makes the user state, per file, whether the numbers
 * already carry a country code or which dial prefix to apply
 * (REQUIREMENTS §7.5).
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js'

export interface NormalizedPhone {
  /** E.164, e.g. +919876543210. Null when the input cannot be understood. */
  e164: string | null
  valid: boolean
  reason?: string
}

/** Dial prefix the user chose to apply, e.g. `+91`. */
export type DialPrefix = string

const MISSING_COUNTRY =
  'no country code — the number must start with + and its country code'

/** `+91`, `0091`, `91` → `+91`. Returns null when it is not a dial prefix. */
export function parseDialPrefix(input: string | null | undefined): DialPrefix | null {
  if (!input) return null
  const digits = input.trim().replace(/^\+/, '').replace(/^00/, '').replace(/\D/g, '')
  if (digits.length < 1 || digits.length > 4) return null
  return `+${digits}`
}

/**
 * Normalize one number.
 *
 * `dialPrefix` is what the user answered at import time. When it is undefined
 * the caller has asserted the numbers already carry their country code, so a
 * bare national number is rejected rather than guessed at.
 */
export function normalizePhone(input: string, dialPrefix?: DialPrefix): NormalizedPhone {
  const raw = input.trim()
  if (raw === '') return { e164: null, valid: false, reason: 'empty' }

  try {
    const candidate = withCountryCode(raw, dialPrefix)
    if (candidate === null) return { e164: null, valid: false, reason: MISSING_COUNTRY }

    const parsed = parsePhoneNumberFromString(candidate)

    if (!parsed) return { e164: null, valid: false, reason: 'unparseable' }
    if (!parsed.isValid()) {
      // Keep the normalized form even when invalid, so the error report can
      // show what it was interpreted as rather than just rejecting it.
      return { e164: parsed.number, valid: false, reason: 'invalid number' }
    }
    return { e164: parsed.number, valid: true }
  } catch (err) {
    return {
      e164: null,
      valid: false,
      reason: err instanceof Error ? err.message : 'error',
    }
  }
}

/**
 * Produce something `parsePhoneNumberFromString` can read without a region.
 *
 * An explicit `+` in the input always wins over the chosen prefix: a list with
 * mixed countries must not be silently rewritten to one of them.
 */
function withCountryCode(raw: string, dialPrefix?: DialPrefix): string | null {
  if (raw.startsWith('+')) return raw

  const digits = raw.replace(/\D/g, '')
  if (digits === '') return null

  // 00 is the other way people write an international prefix.
  if (digits.startsWith('00')) return `+${digits.slice(2)}`

  if (dialPrefix) {
    const prefix = parseDialPrefix(dialPrefix)
    if (!prefix) return null
    // WHY the prefix is applied unconditionally: "does this number already start
    // with its country code?" cannot be answered from the digits. +91 9198765432
    // is a real Indian mobile that begins with 91. Guessing would corrupt a whole
    // list, so the user's answer decides and only an explicit + overrides it.
    return `${prefix}${digits}`
  }

  // The caller asserted the country code is present, so read it as one.
  return `+${digits}`
}

/**
 * Phone normalization to E.164.
 *
 * Numbers are normalized at import and **stored** normalized, because the send
 * path needs a canonical form and re-deriving it per send would be both slower
 * and inconsistent. That storage decision is why the default country code
 * matters so much: changing it after a large import requires re-importing
 * (REQUIREMENTS §7.5, assumption A7).
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

/** Until REQUIREMENTS §7.5 is answered — see assumption A7. */
export const DEFAULT_COUNTRY: CountryCode = 'IN'

export interface NormalizedPhone {
  /** E.164, e.g. +919876543210. Null when the input cannot be understood. */
  e164: string | null
  valid: boolean
  reason?: string
}

export function normalizePhone(
  input: string,
  country: CountryCode = DEFAULT_COUNTRY,
): NormalizedPhone {
  const raw = input.trim()
  if (raw === '') return { e164: null, valid: false, reason: 'empty' }

  try {
    // An explicit +country in the input always wins over the default: a list
    // with mixed countries must not be silently rewritten to one of them.
    const parsed = parsePhoneNumberFromString(
      raw,
      raw.startsWith('+') ? undefined : country,
    )

    if (!parsed) return { e164: null, valid: false, reason: 'unparseable' }
    if (!parsed.isValid()) {
      // Keep the normalized form even when invalid, so the error report can
      // show what it was interpreted as rather than just rejecting it.
      return { e164: parsed.number, valid: false, reason: 'invalid for region' }
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

/** Country code resolution, honoring the user's setting when present. */
export function resolveCountry(setting: string | null | undefined): CountryCode {
  if (!setting) return DEFAULT_COUNTRY
  const trimmed = setting.trim().toUpperCase()
  // Accept either an ISO country code ("IN") or a dial prefix ("+91").
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed as CountryCode
  return DEFAULT_COUNTRY
}

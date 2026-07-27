/**
 * Encrypted value storage (CLAUDE.md §5.6).
 *
 * Uses Electron `safeStorage`, which is backed by DPAPI on Windows and the
 * Keychain on macOS — the key never lives in our own files.
 *
 * If encryption is unavailable (a locked keychain, an unusual desktop session)
 * we degrade **explicitly** and record that the value is not encrypted, rather
 * than writing plaintext while pretending otherwise. Callers can surface that
 * state to the user; silently storing a license key or API key in the clear
 * would be worse than failing loudly.
 */
import { safeStorage } from 'electron'

const PLAINTEXT_PREFIX = 'plain:'

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function encryptValue(value: string): { data: string; encrypted: boolean } {
  if (!isEncryptionAvailable()) {
    console.warn('secure-store: OS encryption unavailable — storing value unencrypted')
    return { data: `${PLAINTEXT_PREFIX}${value}`, encrypted: false }
  }
  return { data: safeStorage.encryptString(value).toString('base64'), encrypted: true }
}

export function decryptValue(data: string): string | null {
  if (data.startsWith(PLAINTEXT_PREFIX)) return data.slice(PLAINTEXT_PREFIX.length)
  try {
    return safeStorage.decryptString(Buffer.from(data, 'base64'))
  } catch (err) {
    // A value encrypted under a different OS user or machine cannot be read.
    // Treat it as absent rather than crashing the boot sequence.
    console.error('secure-store: could not decrypt stored value', err)
    return null
  }
}

/** Mask a license key for display: keep the shape, hide the secret. */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed.length <= 8) return '••••'
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}

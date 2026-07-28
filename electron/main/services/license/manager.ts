/**
 * License state machine and cache (SPRINTS.md §6.8).
 *
 * Owns: which service implementation is in use, the encrypted local record,
 * tamper detection, and the offline grace period. The gate in index.ts and the
 * IPC guard both read `currentStatus()` from here — there is one source of
 * truth for whether the app is licensed.
 */
import { createHmac } from 'node:crypto'
import type { LicenseStatus } from '../../../../shared/types'
import { getPrisma } from '../../db/client'
import { appVersion, deviceFingerprint, deviceName } from '../fingerprint'
import { decryptValue, encryptValue, maskKey } from '../secure-store'
import { HttpLicenseService } from './http'
import { MockLicenseService } from './mock'
import type { LicenseOutcome, LicenseService } from './types'

export interface LicenseInfo {
  status: LicenseStatus
  keyMasked: string | null
  deviceName: string | null
  remarks: string | null
  activatedAt: string | null
  expiresAt: string | null
  lastValidatedAt: string | null
  graceUntil: string | null
}

export interface ConflictInfo {
  deviceName: string
  lastUsedAt: string | null
}

/** Default until REQUIREMENTS §1.6 answers it (assumption A1). */
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000
const REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000

const UNLICENSED: LicenseInfo = {
  status: 'unlicensed',
  keyMasked: null,
  deviceName: null,
  remarks: null,
  activatedAt: null,
  expiresAt: null,
  lastValidatedAt: null,
  graceUntil: null,
}

let service: LicenseService | undefined
let cached: LicenseInfo = UNLICENSED

/**
 * Selected by env so E2E can drive every branch deterministically without a
 * network. Production uses the HTTP client once REQUIREMENTS §1 is filled.
 */
export function getLicenseService(): LicenseService {
  if (!service) {
    if (process.env.LICENSE_SERVICE === 'mock') {
      service = new MockLicenseService()
    } else {
      service = new HttpLicenseService({
        baseUrl: process.env.LICENSE_API_URL ?? 'https://license.invalid/api',
        ...(process.env.LICENSE_API_KEY ? { apiKey: process.env.LICENSE_API_KEY } : {}),
      })
    }
  }
  return service
}

/** Test seam — lets a spec inject a service without touching the environment. */
export function setLicenseService(next: LicenseService | undefined): void {
  service = next
}

/**
 * Signature over the stored record, keyed to this machine.
 *
 * This is tamper *evidence*, not DRM: it stops a user flipping `status` to
 * `valid` in the SQLite file with a database browser. Anyone able to run code
 * as this user can defeat it, and pretending otherwise would be dishonest — the
 * real enforcement is server-side.
 */
function sign(parts: Array<string | null>): string {
  return createHmac('sha256', deviceFingerprint()).update(parts.join('|')).digest('hex')
}

function toInfo(row: {
  status: string
  keyMasked: string
  deviceName: string | null
  remarks: string | null
  activatedAt: Date | null
  expiresAt: Date | null
  lastValidatedAt: Date | null
  graceUntil: Date | null
}): LicenseInfo {
  return {
    status: row.status as LicenseStatus,
    keyMasked: row.keyMasked,
    deviceName: row.deviceName,
    remarks: row.remarks,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
    graceUntil: row.graceUntil?.toISOString() ?? null,
  }
}

async function persist(params: {
  key: string
  status: LicenseStatus
  remarks?: string | null
  expiresAt: string | null
  serverDeviceName: string | null
  graceUntil: string | null
}): Promise<LicenseInfo> {
  const prisma = getPrisma()
  const { data: keyEncrypted } = encryptValue(params.key)
  const keyMasked = maskKey(params.key)
  const now = new Date()

  const signature = sign([params.status, keyMasked, params.expiresAt, params.graceUntil])

  const row = await prisma.license.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      keyEncrypted,
      keyMasked,
      status: params.status,
      remarks: params.remarks ?? null,
      deviceFingerprint: deviceFingerprint(),
      deviceName: params.serverDeviceName,
      activatedAt: now,
      expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
      lastValidatedAt: now,
      graceUntil: params.graceUntil ? new Date(params.graceUntil) : null,
      signature,
    },
    update: {
      keyEncrypted,
      keyMasked,
      status: params.status,
      ...(params.remarks !== undefined ? { remarks: params.remarks } : {}),
      deviceFingerprint: deviceFingerprint(),
      deviceName: params.serverDeviceName,
      expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
      lastValidatedAt: now,
      graceUntil: params.graceUntil ? new Date(params.graceUntil) : null,
      signature,
    },
  })

  cached = toInfo(row)
  return cached
}

async function loadStoredKey(): Promise<string | null> {
  const row = await getPrisma().license.findUnique({ where: { id: 'singleton' } })
  if (!row) return null
  return decryptValue(row.keyEncrypted)
}

/** Read the stored record, verifying its signature and grace window. */
export async function loadLicense(): Promise<LicenseInfo> {
  const row = await getPrisma().license.findUnique({ where: { id: 'singleton' } })
  if (!row) {
    cached = UNLICENSED
    return cached
  }

  const info = toInfo(row)

  const expected = sign([info.status, info.keyMasked, info.expiresAt, info.graceUntil])
  if (row.signature !== expected) {
    console.warn('license: stored record failed signature check — treating as unlicensed')
    cached = UNLICENSED
    return cached
  }

  // A grace window that has run out demotes to invalid on read, so a user
  // cannot stay in grace indefinitely by never reconnecting.
  if (
    info.status === 'grace' &&
    info.graceUntil &&
    new Date(info.graceUntil) < new Date()
  ) {
    cached = { ...info, status: 'invalid' }
    return cached
  }

  if (info.expiresAt && new Date(info.expiresAt) < new Date()) {
    cached = { ...info, status: 'expired' }
    return cached
  }

  cached = info
  return cached
}

export function currentStatus(): LicenseStatus {
  return cached.status
}

/** The gate: only these two states may reach the application. */
export function isUnlocked(): boolean {
  return cached.status === 'valid' || cached.status === 'grace'
}

function statusFor(outcome: LicenseOutcome): LicenseStatus {
  switch (outcome.kind) {
    case 'valid':
      return 'valid'
    case 'expired':
      return 'expired'
    case 'revoked':
      return 'revoked'
    case 'conflict':
      return 'conflict'
    case 'unreachable':
      return 'grace'
    default:
      return 'invalid'
  }
}

export interface ActivationResult {
  status: LicenseStatus
  info: LicenseInfo | null
  conflict: ConflictInfo | null
}

async function apply(
  key: string,
  remarks: string | undefined,
  outcome: LicenseOutcome,
): Promise<ActivationResult> {
  if (outcome.kind === 'conflict') {
    // Deliberately not persisted: a conflict is not an activation, and storing
    // it would leave the app in a state the user never agreed to.
    return {
      status: 'conflict',
      info: null,
      conflict: { deviceName: outcome.deviceName, lastUsedAt: outcome.lastUsedAt },
    }
  }

  if (outcome.kind === 'valid') {
    const info = await persist({
      key,
      status: 'valid',
      remarks: remarks ?? null,
      expiresAt: outcome.expiresAt,
      serverDeviceName: outcome.deviceName ?? deviceName(),
      graceUntil: null,
    })
    return { status: 'valid', info, conflict: null }
  }

  // Rejections are not stored either — nothing about the machine changed.
  return { status: statusFor(outcome), info: null, conflict: null }
}

export async function activate(key: string, remarks?: string): Promise<ActivationResult> {
  const outcome = await getLicenseService().activate({
    key,
    ...(remarks !== undefined ? { remarks } : {}),
    fingerprint: deviceFingerprint(),
    deviceName: deviceName(),
    appVersion: appVersion(),
  })
  return apply(key, remarks, outcome)
}

export async function transfer(key: string, remarks?: string): Promise<ActivationResult> {
  const outcome = await getLicenseService().transfer({
    key,
    ...(remarks !== undefined ? { remarks } : {}),
    fingerprint: deviceFingerprint(),
    deviceName: deviceName(),
    appVersion: appVersion(),
  })
  return apply(key, remarks, outcome)
}

/**
 * Re-check an existing activation.
 *
 * A network failure must not lock a paying user out of software they already
 * activated, so `unreachable` moves to `grace` with a deadline rather than to
 * `invalid`. An explicit rejection is honoured immediately.
 */
export async function revalidate(): Promise<LicenseInfo> {
  const key = await loadStoredKey()
  if (!key) {
    cached = UNLICENSED
    return cached
  }

  const outcome = await getLicenseService().validate({
    key,
    fingerprint: deviceFingerprint(),
    deviceName: deviceName(),
    appVersion: appVersion(),
  })

  if (outcome.kind === 'unreachable') {
    const current = await loadLicense()
    // Keep the deadline from the first failure — successive failures must not
    // extend the window indefinitely.
    const graceUntil =
      current.graceUntil ?? new Date(Date.now() + GRACE_PERIOD_MS).toISOString()
    if (new Date(graceUntil) < new Date()) {
      cached = { ...current, status: 'invalid' }
      return cached
    }
    return persist({
      key,
      status: 'grace',
      expiresAt: current.expiresAt,
      serverDeviceName: current.deviceName,
      graceUntil,
    })
  }

  if (outcome.kind === 'valid') {
    return persist({
      key,
      status: 'valid',
      expiresAt: outcome.expiresAt,
      serverDeviceName: outcome.deviceName ?? deviceName(),
      graceUntil: null,
    })
  }

  const status = statusFor(outcome)
  const info = await persist({
    key,
    status,
    expiresAt: null,
    serverDeviceName: cached.deviceName,
    graceUntil: null,
  })
  return info
}

export async function deactivate(): Promise<void> {
  const key = await loadStoredKey()
  if (key) {
    await getLicenseService().deactivate({
      key,
      fingerprint: deviceFingerprint(),
      deviceName: deviceName(),
      appVersion: appVersion(),
    })
  }
  await getPrisma().license.deleteMany({ where: { id: 'singleton' } })
  cached = UNLICENSED
}

export function getCached(): LicenseInfo {
  return cached
}

export { REVALIDATE_INTERVAL_MS }

/**
 * Stable machine fingerprint for license binding.
 *
 * WHY these inputs: the identifier must survive an app reinstall (so a user is
 * not forced to re-activate), stay stable across reboots and network changes,
 * and differ between machines and between OS users on one machine. Hostname
 * alone changes too easily; MAC alone changes with a docking station or VPN
 * adapter. The composite is hashed so no raw hardware identifier ever leaves
 * the device or lands in a log.
 *
 * Drift is expected and handled: if the fingerprint changes, the server sees a
 * new device and the user resolves it through the normal conflict-transfer
 * flow, which is exactly what that flow exists for.
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, networkInterfaces, platform, userInfo } from 'node:os'
import { join } from 'node:path'
import { userDataDir } from '../db/paths'

const CACHE_FILE = 'device-id'

/** First non-internal MAC, chosen deterministically so ordering cannot vary. */
function primaryMac(): string {
  const macs: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        macs.push(iface.mac)
      }
    }
  }
  return macs.sort()[0] ?? 'no-mac'
}

function computeFingerprint(): string {
  const parts = [
    platform(),
    hostname(),
    primaryMac(),
    // Scopes the identity to the OS user, matching the per-user database.
    String(userInfo().uid ?? userInfo().username),
  ]
  return createHash('sha256').update(parts.join('|')).digest('hex')
}

/**
 * Cached on disk so a transient change (an unplugged dock, a renamed machine)
 * cannot silently invalidate an activation mid-session.
 */
export function deviceFingerprint(): string {
  const file = join(userDataDir(), CACHE_FILE)
  if (existsSync(file)) {
    const cached = readFileSync(file, 'utf8').trim()
    if (/^[a-f0-9]{64}$/.test(cached)) return cached
  }
  const fingerprint = computeFingerprint()
  writeFileSync(file, fingerprint, 'utf8')
  return fingerprint
}

/** Human-readable name shown in the license server's device list. */
export function deviceName(): string {
  return `${hostname()} (${platform()})`
}

export function appVersion(): string {
  return app.getVersion()
}

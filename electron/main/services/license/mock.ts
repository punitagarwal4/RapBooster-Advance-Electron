/**
 * Deterministic license server for tests and for development before
 * REQUIREMENTS §1 is answered.
 *
 * Key prefixes mirror the prototype's demo behaviour so the UI can be exercised
 * against every branch:
 *   VALID-*     → activates
 *   CONFLICT-*  → conflict, then transfers successfully
 *   EXPIRED-*   → expired
 *   REVOKED-*   → revoked
 *   OFFLINE-*   → unreachable (drives the grace-period path)
 *   anything else → invalid
 */
import type { ActivationRequest, LicenseOutcome, LicenseService } from './types'

export class MockLicenseService implements LicenseService {
  /** Keys already transferred to this machine, so a retry succeeds. */
  private readonly transferred = new Set<string>()

  private evaluate(key: string): LicenseOutcome {
    const upper = key.trim().toUpperCase()

    if (upper.startsWith('VALID-')) {
      return { kind: 'valid', expiresAt: null, deviceName: 'This Computer' }
    }
    if (upper.startsWith('CONFLICT-')) {
      if (this.transferred.has(upper)) {
        return { kind: 'valid', expiresAt: null, deviceName: 'This Computer' }
      }
      return {
        kind: 'conflict',
        deviceName: 'Another Computer',
        lastUsedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      }
    }
    if (upper.startsWith('EXPIRED-')) {
      return { kind: 'expired', expiresAt: new Date(Date.now() - 86_400_000).toISOString() }
    }
    if (upper.startsWith('REVOKED-')) {
      return { kind: 'revoked', reason: 'This license has been revoked.' }
    }
    if (upper.startsWith('OFFLINE-')) {
      return { kind: 'unreachable', detail: 'mock: simulated network failure' }
    }
    return { kind: 'invalid', reason: 'Unknown key' }
  }

  async activate(request: ActivationRequest): Promise<LicenseOutcome> {
    return this.evaluate(request.key)
  }

  async transfer(request: ActivationRequest): Promise<LicenseOutcome> {
    const upper = request.key.trim().toUpperCase()
    if (upper.startsWith('CONFLICT-')) {
      this.transferred.add(upper)
      return { kind: 'valid', expiresAt: null, deviceName: 'This Computer' }
    }
    return this.evaluate(request.key)
  }

  async validate(request: Omit<ActivationRequest, 'remarks'>): Promise<LicenseOutcome> {
    return this.evaluate(request.key)
  }

  async deactivate(): Promise<LicenseOutcome> {
    return { kind: 'valid', expiresAt: null, deviceName: null }
  }
}

/**
 * Real license server client.
 *
 * ⚠ THIS IS THE SWAP POINT. Everything below the marked section is written
 * against assumptions, because REQUIREMENTS §1 (endpoints, auth, request and
 * response JSON, outcome mapping) has not been answered yet. When it is, only
 * this file changes — see REQUIREMENTS §0 assumption A1.
 *
 * The assumed shape is a conventional JSON API:
 *   POST {base}/activate    { key, device_id, device_name, app_version, remarks }
 *   POST {base}/transfer    same body, force-releases the previous device
 *   POST {base}/validate    { key, device_id }
 *   POST {base}/deactivate  { key, device_id }
 * responding { status: 'valid'|'invalid'|'expired'|'revoked'|'conflict', ... }.
 */
import type { ActivationRequest, LicenseOutcome, LicenseService } from './types'

export interface HttpLicenseConfig {
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
}

interface ServerResponse {
  status?: string
  expires_at?: string | null
  device_name?: string | null
  last_used_at?: string | null
  message?: string
}

export class HttpLicenseService implements LicenseService {
  constructor(private readonly config: HttpLicenseConfig) {}

  private async post(path: string, body: Record<string, unknown>): Promise<LicenseOutcome> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000)

    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { 'X-Api-Key': this.config.apiKey } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      // 5xx is the server failing, not the license being rejected — it must not
      // lock the user out, so it maps to `unreachable` and the grace period.
      if (response.status >= 500) {
        return { kind: 'unreachable', detail: `server responded ${response.status}` }
      }

      const payload = (await response.json().catch(() => ({}))) as ServerResponse
      return this.mapOutcome(response.status, payload)
    } catch (err) {
      // Network failure, DNS failure, timeout — all indistinguishable from the
      // app's point of view and all non-punitive.
      return {
        kind: 'unreachable',
        detail: err instanceof Error ? err.message : String(err),
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Maps a server response onto the app's outcomes (REQUIREMENTS §1.4). */
  private mapOutcome(httpStatus: number, payload: ServerResponse): LicenseOutcome {
    switch (payload.status) {
      case 'valid':
      case 'active':
        return {
          kind: 'valid',
          expiresAt: payload.expires_at ?? null,
          deviceName: payload.device_name ?? null,
        }
      case 'conflict':
      case 'in_use':
        return {
          kind: 'conflict',
          deviceName: payload.device_name ?? 'Another Computer',
          lastUsedAt: payload.last_used_at ?? null,
        }
      case 'expired':
        return { kind: 'expired', expiresAt: payload.expires_at ?? null }
      case 'revoked':
      case 'blocked':
        return { kind: 'revoked', reason: payload.message ?? 'This license has been revoked.' }
      case 'invalid':
        return { kind: 'invalid', reason: payload.message ?? 'Unknown key' }
      default:
        return httpStatus >= 200 && httpStatus < 300
          ? { kind: 'invalid', reason: payload.message ?? 'Unrecognised server response' }
          : { kind: 'invalid', reason: payload.message ?? `HTTP ${httpStatus}` }
    }
  }

  private body(request: Omit<ActivationRequest, 'remarks'> & { remarks?: string }) {
    return {
      key: request.key,
      device_id: request.fingerprint,
      device_name: request.deviceName,
      app_version: request.appVersion,
      ...(request.remarks ? { remarks: request.remarks } : {}),
    }
  }

  activate(request: ActivationRequest): Promise<LicenseOutcome> {
    return this.post('/activate', this.body(request))
  }

  transfer(request: ActivationRequest): Promise<LicenseOutcome> {
    return this.post('/transfer', this.body(request))
  }

  validate(request: Omit<ActivationRequest, 'remarks'>): Promise<LicenseOutcome> {
    return this.post('/validate', this.body(request))
  }

  deactivate(request: Omit<ActivationRequest, 'remarks'>): Promise<LicenseOutcome> {
    return this.post('/deactivate', this.body(request))
  }
}

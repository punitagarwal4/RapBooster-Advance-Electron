/**
 * The license server contract, as the app needs it.
 *
 * WHY an interface: REQUIREMENTS §1 is not filled in yet, so the real endpoint
 * shapes are unknown. Everything above this line is written against these four
 * methods, which means wiring the customer's actual API later touches exactly
 * one file (`http.ts`) — no UI, state machine or gate has to change.
 */

export type LicenseOutcome =
  | { kind: 'valid'; expiresAt: string | null; deviceName: string | null }
  | { kind: 'invalid'; reason: string }
  | { kind: 'expired'; expiresAt: string | null }
  | { kind: 'revoked'; reason: string }
  /** The key is active on another machine; the UI offers a transfer. */
  | { kind: 'conflict'; deviceName: string; lastUsedAt: string | null }
  /** Could not reach the server. Distinct from rejection — drives offline grace. */
  | { kind: 'unreachable'; detail: string }

export interface ActivationRequest {
  key: string
  remarks?: string
  fingerprint: string
  deviceName: string
  appVersion: string
}

export interface LicenseService {
  /** Bind this key to this machine. */
  activate(request: ActivationRequest): Promise<LicenseOutcome>
  /** Deactivate elsewhere, then bind here. Invoked from the conflict dialog. */
  transfer(request: ActivationRequest): Promise<LicenseOutcome>
  /** Periodic re-check of an existing activation. */
  validate(request: Omit<ActivationRequest, 'remarks'>): Promise<LicenseOutcome>
  /** Release this machine's seat. */
  deactivate(request: Omit<ActivationRequest, 'remarks'>): Promise<LicenseOutcome>
}

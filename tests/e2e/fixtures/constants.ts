/**
 * Shared E2E timing bounds.
 *
 * These guard *launching and reaching a screen*, not assertions about
 * behaviour, so a generous value costs nothing when the app is healthy — a
 * passing test returns in a second or two regardless. What a tight value does
 * cost is false failures on a loaded machine, which is worse than useless
 * because it trains everyone to re-run rather than investigate.
 *
 * `global-setup.ts` absorbs first-launch disk warm-up separately, so this only
 * has to cover ordinary variance.
 */
export const APP_READY_TIMEOUT_MS = 90_000

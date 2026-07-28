/**
 * Typed error taxonomy (SPRINTS.md §5.4, CLAUDE.md §5.1).
 *
 * Every IPC handler maps its failures onto these codes. A raw Error reaching the
 * renderer is a bug: the renderer cannot reason about arbitrary messages, and
 * raw messages routinely contain paths, phone numbers or keys that must not be
 * shown to a user or written to a log.
 *
 * Each error carries two separate strings on purpose:
 *   userMessage — safe to display verbatim
 *   detail      — logged, never rendered
 */

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',

  'LICENSE_REQUIRED',
  'LICENSE_INVALID',
  'LICENSE_CONFLICT',
  'LICENSE_EXPIRED',

  'DEVICE_NOT_CONNECTED',
  'DEVICE_LOGGED_OUT',
  'DEVICE_LIMIT_REACHED',

  'WA_SERVICE_DOWN',

  'SEND_FAILED',
  'RATE_LIMITED',
  'DAILY_CAP_REACHED',

  'AI_KEY_MISSING',
  'AI_KEY_INVALID',
  'AI_RATE_LIMITED',
  'AI_TIMEOUT',

  'IMPORT_FAILED',
  'EXPORT_FAILED',

  'DB_ERROR',
  'MIGRATION_FAILED',
  'INTEGRITY_FAILED',

  'NETWORK_ERROR',
  'UNKNOWN',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** Default user-facing copy. Handlers may override with something more specific. */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'That request was not valid. Please check the values and try again.',
  NOT_FOUND: 'That item no longer exists.',
  CONFLICT: 'That already exists.',

  LICENSE_REQUIRED: 'A license is required to use this feature.',
  LICENSE_INVALID: 'Invalid license key. Please check and try again.',
  LICENSE_CONFLICT: 'This license key is already activated on another system.',
  LICENSE_EXPIRED: 'This license has expired.',

  DEVICE_NOT_CONNECTED: 'That device is not connected.',
  DEVICE_LOGGED_OUT: 'That device was logged out of WhatsApp and must be linked again.',
  DEVICE_LIMIT_REACHED: 'The maximum number of connected devices has been reached.',

  WA_SERVICE_DOWN: 'The WhatsApp service is not running. It will restart automatically.',

  SEND_FAILED: 'The message could not be sent.',
  RATE_LIMITED: 'WhatsApp is rate limiting this account. Sending will resume shortly.',
  DAILY_CAP_REACHED: 'This device has reached its daily sending limit.',

  AI_KEY_MISSING:
    'No OpenAI API key is configured. Add one in Settings to enable auto-replies.',
  AI_KEY_INVALID: 'The OpenAI API key was rejected. Check it in Settings.',
  AI_RATE_LIMITED: 'OpenAI is rate limiting requests. Auto-replies will resume shortly.',
  AI_TIMEOUT: 'The AI request timed out.',

  IMPORT_FAILED: 'The file could not be imported.',
  EXPORT_FAILED: 'The file could not be exported.',

  DB_ERROR: 'A database error occurred.',
  MIGRATION_FAILED: 'The database could not be upgraded.',
  INTEGRITY_FAILED: 'The database failed its integrity check.',

  NETWORK_ERROR: 'Could not reach the server. Check your internet connection.',
  UNKNOWN: 'Something went wrong.',
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly userMessage: string
  readonly detail?: string
  /** Extra context for the renderer, e.g. the conflicting device on a license clash. */
  readonly data?: Record<string, unknown>

  constructor(
    code: ErrorCode,
    options: {
      userMessage?: string
      detail?: string
      data?: Record<string, unknown>
      cause?: unknown
    } = {},
  ) {
    super(options.detail ?? DEFAULT_MESSAGES[code], { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.userMessage = options.userMessage ?? DEFAULT_MESSAGES[code]
    this.detail = options.detail
    this.data = options.data
  }
}

/** Wire shape. Errors cross IPC as plain objects — Error does not structured-clone. */
export interface SerializedError {
  code: ErrorCode
  userMessage: string
  detail?: string
  data?: Record<string, unknown>
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof AppError) {
    return {
      code: err.code,
      userMessage: err.userMessage,
      ...(err.detail !== undefined ? { detail: err.detail } : {}),
      ...(err.data !== undefined ? { data: err.data } : {}),
    }
  }
  // An unmapped throw is a bug, not a user-facing condition. Say something safe
  // and keep the real text for the log.
  return {
    code: 'UNKNOWN',
    userMessage: DEFAULT_MESSAGES.UNKNOWN,
    detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  }
}

export function isSerializedError(value: unknown): value is SerializedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'userMessage' in value &&
    (ERROR_CODES as readonly string[]).includes((value as SerializedError).code)
  )
}

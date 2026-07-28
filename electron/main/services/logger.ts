/**
 * Application logging (CLAUDE.md §5.2).
 *
 * Redaction is applied by the logger itself, not by each call site. Call-site
 * discipline fails eventually — someone logs an error object that happens to
 * contain a phone number — and log files routinely get emailed to support.
 * Assume every line here will be read by someone who should not see customer
 * data.
 */
import log from 'electron-log/main'
import { logsDir } from '../db/paths'

/**
 * Patterns that must never reach a log file.
 *
 * Phone numbers keep their last 4 digits: enough to correlate a report with a
 * recipient during support, not enough to identify or contact them.
 */
const REDACTIONS: Array<{
  pattern: RegExp
  replace: (match: string, ...args: string[]) => string
}> = [
  // E.164 and loosely-formatted international numbers.
  {
    pattern: /\+?\d[\d\s\-().]{7,}\d/g,
    replace: (match) => {
      const digits = match.replace(/\D/g, '')
      if (digits.length < 8) return match
      return `+${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
    },
  },
  // OpenAI-style keys.
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replace: () => 'sk-[REDACTED]' },
  // Bearer tokens and api-key headers.
  {
    pattern: /\b(Bearer|X-Api-Key:?)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_m, p1) => `${p1} [REDACTED]`,
  },
  // License keys: grouped alphanumerics separated by hyphens, e.g. VALID-2024-001.
  {
    pattern: /\b[A-Z0-9]{4,}-[A-Z0-9]{2,}-[A-Z0-9]{2,}\b/g,
    replace: () => '[REDACTED-KEY]',
  },
]

export function redact(input: string): string {
  let output = input
  for (const { pattern, replace } of REDACTIONS) {
    output = output.replace(
      pattern,
      replace as (substring: string, ...args: unknown[]) => string,
    )
  }
  return output
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]'
  if (typeof value === 'string') return redact(value)
  if (value instanceof Error) {
    return `${value.name}: ${redact(value.message)}`
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Never log a value under one of these names, whatever it looks like.
      out[k] = /key|token|secret|password|authorization/i.test(k)
        ? '[REDACTED]'
        : redactValue(v, depth + 1)
    }
    return out
  }
  return value
}

let initialized = false

export function initLogger(): void {
  if (initialized) return
  initialized = true

  log.transports.file.resolvePathFn = () => `${logsDir()}/main.log`
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.level = 'info'
  log.transports.console.level = 'debug'

  // Applies to every transport, so nothing can bypass it by choosing a level.
  log.hooks.push((message) => {
    message.data = message.data.map((d) => redactValue(d))
    return message
  })

  log.initialize()

  // Console output from anywhere in main is captured, which means the existing
  // console.* calls throughout the codebase land in the log file redacted
  // rather than needing a mechanical rewrite.
  Object.assign(console, log.functions)
}

export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', reason)
  })
}

export { log }

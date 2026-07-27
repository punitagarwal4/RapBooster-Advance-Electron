/**
 * Bulk group naming (SPRINTS.md §2.4).
 *
 * Lives in `shared` for the same reason merge-tag rendering does: the dialog
 * previews these names and the runner creates them. Two implementations would
 * drift, and the user would only find out after 100 groups existed with the
 * wrong names.
 */
import type { SuffixRule } from './types'

/**
 * Name for the Nth group (0-based).
 *
 * Sequential numbers are zero-padded to three digits so an alphabetical listing
 * in WhatsApp matches creation order — "Sales 10" sorting before "Sales 2" is
 * the kind of small wrongness that makes a tool feel unfinished.
 */
export function groupName(prefix: string, rule: SuffixRule, index: number): string {
  switch (rule) {
    case 'number':
      return `${prefix} ${String(index + 1).padStart(3, '0')}`
    case 'alphabet': {
      // A–Z, then AA, AB… so counts above 26 stay unique.
      let n = index
      let suffix = ''
      do {
        suffix = String.fromCharCode(65 + (n % 26)) + suffix
        n = Math.floor(n / 26) - 1
      } while (n >= 0)
      return `${prefix} ${suffix}`
    }
    case 'timestamp':
      return `${prefix} ${Math.floor(Date.now() / 1000) + index}`
    case 'none':
      return prefix
  }
}

/** First few names plus an ellipsis, matching the prototype's preview line. */
export function groupNamePreview(prefix: string, rule: SuffixRule, count: number): string {
  const shown = Math.min(3, Math.max(0, count))
  const names = Array.from({ length: shown }, (_, i) => groupName(prefix, rule, i))
  return count > shown ? `${names.join(', ')}...` : names.join(', ')
}

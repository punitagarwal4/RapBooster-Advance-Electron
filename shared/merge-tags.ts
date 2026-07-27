/**
 * Merge tags: `{{Field}}` substitution (SPRINTS.md §6.6).
 *
 * Lives in `shared` because the renderer previews with it and the send path
 * resolves with it. Two implementations would eventually disagree, and the
 * failure mode — a preview that does not match what was actually sent — is
 * exactly the kind a user only discovers after messaging thousands of people.
 */

/** `{{ Name }}` — whitespace tolerated, field names are matched case-insensitively. */
const TAG = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Escapes so a literal `{{` can be written without triggering substitution. */
const ESCAPED_OPEN = /\\\{\\\{/g
const ESCAPED_CLOSE = /\\\}\\\}/g

export interface RenderResult {
  text: string
  /** Tags with no matching field — surfaced rather than silently blanked. */
  unresolved: string[]
}

export function extractTags(template: string): string[] {
  const found = new Set<string>()
  for (const [, name] of template.matchAll(TAG)) {
    if (name) found.add(name.trim())
  }
  return [...found]
}

/**
 * Substitute tags from a contact's field map.
 *
 * Missing values render as an empty string by default. The alternative —
 * leaving `{{Company}}` visible in a sent message — looks broken to the
 * recipient, whereas a gap usually reads as an ordinary sentence. Callers that
 * would rather skip such recipients can inspect `unresolved`.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
): RenderResult {
  const lookup = new Map<string, string>()
  for (const [key, value] of Object.entries(values)) {
    lookup.set(key.trim().toLowerCase(), value)
  }

  const unresolved = new Set<string>()

  const text = template.replace(TAG, (_match, rawName: string) => {
    const name = rawName.trim()
    const value = lookup.get(name.toLowerCase())
    if (value === undefined || value === '') {
      if (value === undefined) unresolved.add(name)
      return ''
    }
    return value
  })

  return {
    text: text.replace(ESCAPED_OPEN, '{{').replace(ESCAPED_CLOSE, '}}'),
    unresolved: [...unresolved],
  }
}

/**
 * Tags a template uses that the given field set does not provide.
 *
 * Checked at template save and again at campaign creation, because a list can
 * gain or lose fields between the two.
 */
export function missingTags(template: string, availableFields: string[]): string[] {
  const available = new Set(availableFields.map((f) => f.trim().toLowerCase()))
  return extractTags(template).filter((tag) => !available.has(tag.toLowerCase()))
}

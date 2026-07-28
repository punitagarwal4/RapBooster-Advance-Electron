/**
 * Button validation and decoding, shared by main and the renderer.
 *
 * One implementation so the dialog's error message and the IPC handler's
 * rejection can never disagree — and so a template written before buttons were
 * structured still opens (SPRINT-TRACKER D70).
 */
import {
  MAX_CALL_BUTTONS,
  MAX_COPY_BUTTONS,
  MAX_REPLY_BUTTONS,
  MAX_TEMPLATE_BUTTONS,
  MAX_URL_BUTTONS,
  type TemplateButton,
  type TemplateButtonType,
} from './types'

const LIMIT: Record<TemplateButtonType, number> = {
  reply: MAX_REPLY_BUTTONS,
  url: MAX_URL_BUTTONS,
  call: MAX_CALL_BUTTONS,
  copy: MAX_COPY_BUTTONS,
}

const NEEDS_VALUE: Record<TemplateButtonType, boolean> = {
  reply: false,
  url: true,
  call: true,
  copy: true,
}

/** Human-readable rejection, or null when the set is sendable. */
export function validateButtons(buttons: TemplateButton[]): string | null {
  if (buttons.length > MAX_TEMPLATE_BUTTONS) {
    return `A template can carry at most ${MAX_TEMPLATE_BUTTONS} buttons.`
  }

  const counts: Record<string, number> = {}
  for (const button of buttons) {
    counts[button.type] = (counts[button.type] ?? 0) + 1

    if (NEEDS_VALUE[button.type] && (button.value ?? '').trim() === '') {
      return `The ${button.type} button "${button.label}" needs a value.`
    }
    if (button.type === 'url' && !/^https?:\/\/\S+$/i.test(button.value ?? '')) {
      return `"${button.label}" must link to a full http(s) URL.`
    }
    if (button.type === 'call' && !/^\+?[\d\s()-]{6,20}$/.test(button.value ?? '')) {
      return `"${button.label}" must dial a phone number, with its country code.`
    }
  }

  for (const [type, count] of Object.entries(counts)) {
    const max = LIMIT[type as TemplateButtonType]
    if (count > max) {
      return `WhatsApp allows at most ${max} ${type} button${max === 1 ? '' : 's'}.`
    }
  }

  return null
}

/**
 * Read the stored JSON, accepting both shapes.
 *
 * Templates created before REQUIREMENTS §7.9 was answered hold `string[]` — a
 * list of labels that could only ever be quick replies, so that is what they
 * become. Anything unreadable yields an empty list rather than throwing: a
 * corrupt button list must not make a template unopenable.
 */
export function decodeButtons(json: string | null | undefined): TemplateButton[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap<TemplateButton>((entry) => {
      if (typeof entry === 'string') {
        return entry.trim() === '' ? [] : [{ type: 'reply', label: entry }]
      }
      if (entry !== null && typeof entry === 'object') {
        const raw = entry as Record<string, unknown>
        const label = typeof raw.label === 'string' ? raw.label : ''
        const type = typeof raw.type === 'string' ? raw.type : 'reply'
        if (label === '') return []
        if (type !== 'reply' && type !== 'url' && type !== 'call' && type !== 'copy') {
          return []
        }
        return [
          {
            type,
            label,
            ...(typeof raw.value === 'string' ? { value: raw.value } : {}),
          },
        ]
      }
      return []
    })
  } catch {
    // Deliberately not fatal — see the doc comment above.
    return []
  }
}

/** The text form used when a real interactive send is impossible. */
export function buttonsAsNumberedText(body: string, buttons: TemplateButton[]): string {
  if (buttons.length === 0) return body
  const lines = buttons.map((b, i) => {
    const suffix =
      b.type === 'url' || b.type === 'call' ? ` — ${(b.value ?? '').trim()}` : ''
    return `${i + 1}. ${b.label}${suffix}`
  })
  return `${body}\n\n${lines.join('\n')}`
}

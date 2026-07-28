/**
 * One template → one wire payload.
 *
 * WHY this is shared: campaigns and group sends both send templates, and they
 * used to build the payload separately. The group path only ever built plain
 * text, so a media or button template lost everything but its body when sent to
 * a group — silently, because a text message is a perfectly valid thing to send.
 * One builder means a template behaves the same wherever it is used.
 */
import { renderTemplate } from '../../../shared/merge-tags'
import { decodeButtons } from '../../../shared/template-buttons'
import type { WaButton, WaOutgoing } from '../../../shared/wa-protocol'

export interface TemplateRow {
  type: string
  content: string
  mediaType: string | null
  mediaPath: string | null
  options: string | null
  buttons: string | null
  footer: string | null
  listButtonText: string | null
}

/** Default label on the control that opens an interactive template's list. */
const DEFAULT_LIST_BUTTON = 'View options'

function parseOptions(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed)
      ? parsed.filter((o): o is string => typeof o === 'string' && o.trim() !== '')
      : []
  } catch {
    // A corrupt option list must not stop a send — it degrades to plain text.
    return []
  }
}

/** Ids are stable per position so a tapped reply can be traced back. */
function withIds(buttons: ReturnType<typeof decodeButtons>): WaButton[] {
  return buttons.map((button, index) => ({
    type: button.type,
    id: `btn_${index + 1}`,
    label: button.label,
    ...(button.value ? { value: button.value } : {}),
  }))
}

export function buildTemplateMessage(
  template: TemplateRow,
  values: Record<string, string>,
): WaOutgoing {
  const { text } = renderTemplate(template.content, values)
  const footer = template.footer?.trim()

  if (template.type === 'media' && template.mediaPath) {
    return {
      kind: 'media',
      path: template.mediaPath,
      mediaType: (template.mediaType as 'image' | 'video') ?? 'image',
      ...(text ? { caption: text } : {}),
    }
  }

  if (template.type === 'button') {
    const buttons = withIds(decodeButtons(template.buttons))
    if (buttons.length > 0) {
      return {
        kind: 'buttons',
        body: text,
        ...(footer ? { footer } : {}),
        buttons,
      }
    }
  }

  if (template.type === 'interactive') {
    const options = parseOptions(template.options)
    if (options.length > 0) {
      return {
        kind: 'list',
        body: text,
        ...(footer ? { footer } : {}),
        buttonText: template.listButtonText?.trim() || DEFAULT_LIST_BUTTON,
        rows: options.map((title, index) => ({ id: `row_${index + 1}`, title })),
      }
    }
  }

  return { kind: 'text', body: footer ? `${text}\n\n${footer}` : text }
}

/**
 * Prompt construction for the auto-responder.
 *
 * Kept separate from the OpenAI client so it can be reasoned about — and
 * changed — without touching network code. Every field the AI Bot screen
 * exposes has to actually reach the model, or the settings are theatre.
 */

export interface ChatbotSettings {
  systemInstructions: string
  businessName: string | null
  businessEmail: string | null
  businessPhone: string | null
  tone: string
  industry: string | null
  primaryGoal: string
  responseStyle: string
  language: string
  escalationTrigger: string
  escalationKeywords: string[]
  products: string
  knowledgeBase: string
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

const STYLE_HINT: Record<string, string> = {
  conversational: 'Write naturally, as in a chat. Two or three sentences at most.',
  bullets: 'Answer with short bullet points.',
  detailed: 'Give a thorough answer, but stay under 200 words.',
  concise: 'Answer in one or two short sentences.',
}

const GOAL_HINT: Record<string, string> = {
  support: 'Your job is to resolve the customer’s problem.',
  sales:
    'Your job is to understand their need and move towards a sale, without pressuring.',
  inquiry: 'Your job is to answer questions accurately.',
  booking: 'Your job is to help them book an appointment.',
  feedback: 'Your job is to collect useful feedback.',
}

/** "Name | Description" per line — the prototype's bulk format. */
function parseProducts(raw: string): string {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return ''

  const items = lines.map((line) => {
    const [name, ...rest] = line.split('|')
    return rest.length > 0 ? `- ${name?.trim()}: ${rest.join('|').trim()}` : `- ${line}`
  })
  return `\n\nProducts and services:\n${items.join('\n')}`
}

/** "Q: … | A: …" per line — the prototype's bulk format. */
function parseKnowledge(raw: string): string {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return ''

  const items = lines.map((line) => {
    const [q, ...rest] = line.split('|')
    return rest.length > 0
      ? `- ${q?.replace(/^Q:\s*/i, '').trim()} → ${rest
          .join('|')
          .replace(/^\s*A:\s*/i, '')
          .trim()}`
      : `- ${line}`
  })
  return `\n\nKnown answers:\n${items.join('\n')}`
}

export function buildSystemPrompt(settings: ChatbotSettings): string {
  const parts: string[] = []

  parts.push(
    settings.systemInstructions.trim() ||
      'You are a helpful assistant replying to customers on WhatsApp.',
  )

  if (settings.businessName) {
    const contact = [
      settings.businessEmail ? `email ${settings.businessEmail}` : null,
      settings.businessPhone ? `phone ${settings.businessPhone}` : null,
    ]
      .filter(Boolean)
      .join(', ')
    parts.push(
      `You represent ${settings.businessName}${contact ? ` (${contact})` : ''}.` +
        (settings.industry ? ` The business operates in ${settings.industry}.` : ''),
    )
  }

  parts.push(`Tone: ${settings.tone}.`)
  parts.push(GOAL_HINT[settings.primaryGoal] ?? GOAL_HINT.support!)
  parts.push(STYLE_HINT[settings.responseStyle] ?? STYLE_HINT.conversational!)
  parts.push(`Reply in ${settings.language}.`)

  // These constraints are not stylistic — a model that ignores them produces
  // messages that get an account reported.
  parts.push(
    'This is WhatsApp, so keep replies short and never use markdown formatting. ' +
      'Never invent prices, availability, or policies. If you do not know something, say so ' +
      'and offer to connect a human.',
  )

  return (
    parts.join(' ') +
    parseProducts(settings.products) +
    parseKnowledge(settings.knowledgeBase)
  )
}

/**
 * Whether an incoming message should go to a human instead of the model.
 *
 * Only the keyword trigger is implemented. OpenAI does not return a confidence
 * score, so the prototype's threshold cannot be honoured directly — see
 * REQUIREMENTS §5 and assumption A13.
 */
export function shouldEscalate(body: string, settings: ChatbotSettings): boolean {
  if (settings.escalationTrigger !== 'keywords') return false

  const keywords =
    settings.escalationKeywords.length > 0
      ? settings.escalationKeywords
      : ['urgent', 'complaint', 'refund', 'lawyer', 'manager', 'cancel my']

  const lower = body.toLowerCase()
  return keywords.some((k) => k.trim() !== '' && lower.includes(k.trim().toLowerCase()))
}

export function buildMessages(
  settings: ChatbotSettings,
  history: HistoryMessage[],
  incoming: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system', content: buildSystemPrompt(settings) },
    ...history,
    { role: 'user', content: incoming },
  ]
}

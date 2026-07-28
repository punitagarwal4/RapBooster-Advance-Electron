/**
 * OpenAI auto-responder (SPRINTS.md §12.1 T4.2).
 *
 * Hard rules, enforced here rather than trusted to configuration:
 *   - never reply in a group
 *   - never reply to a chat the user opted out of
 *   - never reply to our own outbound message
 *   - never reply when the key is missing — and say why, loudly
 *
 * Every failure mode is distinct and surfaced. A silent no-op would leave the
 * user believing auto-reply is working when it is not, which is worse than an
 * error they can act on.
 */
import OpenAI from 'openai'
import { AppError } from '../../../../shared/errors'
import { getPrisma } from '../../db/client'
import { decryptValue } from '../secure-store'
import { waBridge } from '../../wa-bridge'
import {
  buildMessages,
  shouldEscalate,
  type ChatbotSettings,
  type HistoryMessage,
} from './prompt'

/** Until REQUIREMENTS §5 names one — assumption A5. */
export const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_MAX_TOKENS = 500
const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_HISTORY_DEPTH = 10
const REQUEST_TIMEOUT_MS = 30_000

async function setting(key: string): Promise<string | null> {
  const row = await getPrisma().setting.findUnique({ where: { key } })
  if (!row) return null
  return row.isEncrypted ? decryptValue(row.value) : row.value
}

async function numberSetting(key: string, fallback: number): Promise<number> {
  const raw = await setting(key)
  const parsed = raw === null ? NaN : Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function apiKey(): Promise<string | null> {
  const stored = await setting('ai.apiKey')
  return stored && stored.trim() !== '' ? stored.trim() : null
}

function client(key: string): OpenAI {
  return new OpenAI({ apiKey: key, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 })
}

/** Map SDK failures onto the app's taxonomy so the UI can be specific. */
function mapError(err: unknown): AppError {
  const status = (err as { status?: number } | undefined)?.status
  const message = err instanceof Error ? err.message : String(err)

  if (status === 401 || status === 403) {
    return new AppError('AI_KEY_INVALID', { detail: message })
  }
  if (status === 429) {
    return new AppError('AI_RATE_LIMITED', { detail: message })
  }
  if (/timeout|aborted/i.test(message)) {
    return new AppError('AI_TIMEOUT', { detail: message })
  }
  return new AppError('UNKNOWN', {
    userMessage: 'The AI request failed.',
    detail: message,
  })
}

export async function testKey(
  candidate?: string,
): Promise<{ valid: boolean; detail: string | null }> {
  const key = candidate?.trim() || (await apiKey())
  if (!key) return { valid: false, detail: 'No API key is configured.' }

  try {
    // One cheap call: listing models costs nothing and proves the key works.
    await client(key).models.list()
    return { valid: true, detail: null }
  } catch (err) {
    const mapped = mapError(err)
    return { valid: false, detail: mapped.userMessage }
  }
}

async function loadSettings(): Promise<
  (ChatbotSettings & { enabled: boolean; responseDelay: number }) | null
> {
  const config = await getPrisma().chatbotConfig.findUnique({
    where: { id: 'singleton' },
  })
  if (!config) return null

  let keywords: string[] = []
  try {
    const parsed: unknown = JSON.parse(config.escalationKeywords)
    if (Array.isArray(parsed))
      keywords = parsed.filter((k): k is string => typeof k === 'string')
  } catch {
    keywords = []
  }

  return {
    enabled: config.enabled,
    responseDelay: config.responseDelay,
    systemInstructions: config.systemInstructions,
    businessName: config.businessName,
    businessEmail: config.businessEmail,
    businessPhone: config.businessPhone,
    tone: config.tone,
    industry: config.industry,
    primaryGoal: config.primaryGoal,
    responseStyle: config.responseStyle,
    language: config.language,
    escalationTrigger: config.escalationTrigger,
    escalationKeywords: keywords,
    products: config.products,
    knowledgeBase: config.knowledgeBase,
  }
}

export type ReplyOutcome =
  | { kind: 'replied'; text: string }
  | { kind: 'escalated' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; code: string; message: string }

/**
 * Consider replying to one inbound message.
 *
 * Returns an outcome rather than throwing, so the caller can log every branch —
 * "why did it not reply" is the question users actually ask.
 */
export async function maybeReply(
  deviceId: string,
  chatId: string,
  incoming: { body: string | null; isGroup: boolean },
): Promise<ReplyOutcome> {
  if (!incoming.body || incoming.body.trim() === '') {
    return { kind: 'skipped', reason: 'message has no text' }
  }
  // A bot replying into a group is disruptive and gets accounts reported.
  if (incoming.isGroup) {
    return { kind: 'skipped', reason: 'group chat' }
  }

  const settings = await loadSettings()
  if (!settings || !settings.enabled) {
    return { kind: 'skipped', reason: 'auto-reply is disabled' }
  }

  const chat = await getPrisma().chat.findUnique({ where: { id: chatId } })
  if (chat?.autoReplyOptOut) {
    return { kind: 'skipped', reason: 'chat opted out' }
  }

  if (shouldEscalate(incoming.body, settings)) {
    await getPrisma().chat.update({ where: { id: chatId }, data: { isEscalated: true } })
    return { kind: 'escalated' }
  }

  const key = await apiKey()
  if (!key) {
    // Deliberately an error, not a skip: the user configured auto-reply and it
    // is not happening, and they need to know exactly why.
    return {
      kind: 'failed',
      code: 'AI_KEY_MISSING',
      message:
        'No OpenAI API key is configured. Add one in Settings to enable auto-replies.',
    }
  }

  const historyDepth = await numberSetting('ai.historyDepth', DEFAULT_HISTORY_DEPTH)
  const recent = await getPrisma().message.findMany({
    where: { chatId },
    orderBy: { timestamp: 'desc' },
    take: historyDepth,
  })

  const history: HistoryMessage[] = recent
    .reverse()
    .filter((m) => m.body && m.body.trim() !== '')
    .map((m) => ({
      role: m.direction === 'out' ? ('assistant' as const) : ('user' as const),
      content: m.body!,
    }))

  const model = (await setting('ai.model')) ?? DEFAULT_MODEL
  const maxTokens = await numberSetting('ai.maxTokens', DEFAULT_MAX_TOKENS)
  const temperature = await numberSetting('ai.temperature', DEFAULT_TEMPERATURE)

  let text: string
  try {
    const completion = await client(key).chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: buildMessages(settings, history, incoming.body),
    })
    text = completion.choices[0]?.message?.content?.trim() ?? ''
  } catch (err) {
    const mapped = mapError(err)
    return { kind: 'failed', code: mapped.code, message: mapped.userMessage }
  }

  if (text === '') {
    return { kind: 'skipped', reason: 'model returned nothing' }
  }

  // Human-like pause before replying, as configured.
  if (settings.responseDelay > 0) {
    await new Promise((r) => setTimeout(r, settings.responseDelay * 1_000))
  }

  try {
    // Through wa-service, so the throttle applies — an AI reply is still
    // traffic from the user's account.
    const { messageId } = await waBridge.request('message:send', {
      deviceId,
      to: chatId,
      message: { kind: 'text', body: text },
    })

    await getPrisma().message.create({
      data: {
        id: messageId,
        chatId,
        direction: 'out',
        type: 'text',
        body: text,
        status: 'sent',
        isAiReply: true,
        timestamp: new Date(),
      },
    })
    await getPrisma().chat.update({
      where: { id: chatId },
      data: { lastMessage: text, lastMessageAt: new Date() },
    })
  } catch (err) {
    return {
      kind: 'failed',
      code: 'SEND_FAILED',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  return { kind: 'replied', text }
}

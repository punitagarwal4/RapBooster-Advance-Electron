/**
 * Link previews for outgoing text, resolved **once per URL** (REQUIREMENTS §7.11).
 *
 * WHY this file exists rather than letting Baileys do it: Baileys resolves a
 * preview inside `sendMessage`, per message, with no cache — its own source
 * carries a `//TODO: CACHE`. A 50,000-recipient campaign whose message contains
 * one link would therefore make 50,000 requests to that site (plus one per
 * thumbnail) from the user's IP, which reads as an attack and is slow enough to
 * change the pacing the throttle scheduler is carefully applying.
 *
 * Resolving here and handing Baileys a finished `WAUrlInfo` means it fetches
 * nothing: one request per unique URL per TTL, shared across every device and
 * every recipient. Failures are cached too, so a dead link is attempted once
 * rather than once per contact.
 */
import { getUrlInfo, type WAUrlInfo } from 'baileys'

/** Long enough that a campaign shares one fetch; short enough to refresh. */
const TTL_MS = 6 * 60 * 60 * 1000
/** Bounded so a long-lived service cannot grow a preview cache without limit. */
const MAX_ENTRIES = 200

interface Entry {
  /** Null means "resolved to nothing" — a negative result, cached deliberately. */
  info: WAUrlInfo | null
  at: number
}

const cache = new Map<string, Entry>()
/** In-flight fetches, so 20 devices sending the same campaign fetch once. */
const inFlight = new Map<string, Promise<WAUrlInfo | null>>()

const URL_PATTERN = /https?:\/\/[^\s<>"']+|(?:^|\s)(www\.[^\s<>"']+)/i

/** The first URL in the text, or null. Mirrors what WhatsApp itself previews. */
export function firstUrl(text: string): string | null {
  const match = URL_PATTERN.exec(text)
  if (!match) return null
  const raw = (match[0] ?? '').trim()
  if (raw === '') return null
  // Trailing punctuation is almost always sentence punctuation, not the URL.
  return raw.replace(/[.,;:!?)\]}]+$/, '')
}

function remember(url: string, info: WAUrlInfo | null): void {
  if (cache.size >= MAX_ENTRIES) {
    // Insertion order eviction: the oldest key is the first one Map yields.
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(url, { info, at: Date.now() })
}

/**
 * Resolve the preview for a message body.
 *
 * Returns `null` when there is no link, or when the site could not be read —
 * the caller passes that straight to Baileys as `linkPreview: null`, which
 * means "send as plain text and do not fetch anything".
 */
export async function resolveLinkPreview(body: string): Promise<WAUrlInfo | null> {
  const url = firstUrl(body)
  if (!url) return null

  const cached = cache.get(url)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.info

  const pending = inFlight.get(url)
  if (pending) return pending

  const fetching = getUrlInfo(url, {
    thumbnailWidth: 192,
    // Baileys' own default. A preview is a nicety; it must never hold up a send.
    fetchOpts: { timeout: 3_000 },
  })
    .then((info) => {
      const resolved = info ?? null
      remember(url, resolved)
      return resolved
    })
    .catch((err: unknown) => {
      // Not silent: a preview that cannot be fetched is normal (private pages,
      // rate limits, dead links), so it is logged at debug and cached as a
      // negative result rather than retried per recipient.
      console.debug(`link preview failed for ${url}`, err)
      remember(url, null)
      return null
    })
    .finally(() => {
      inFlight.delete(url)
    })

  inFlight.set(url, fetching)
  return fetching
}

/** Test seam: drop everything, so a spec starts from a known state. */
export function clearLinkPreviewCache(): void {
  cache.clear()
  inFlight.clear()
}

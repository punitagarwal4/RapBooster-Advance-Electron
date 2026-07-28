/**
 * Process-wide security policy (T1.3, CLAUDE.md §5.6).
 *
 * The window-level flags live in window creation; this file holds the policies
 * that must apply to every session and every window, including ones opened by
 * code that forgets to think about security.
 */
import { session, shell, type BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ORIGIN } from './app-protocol'

/**
 * Hosts the app is allowed to open in the user's real browser. Anything else is
 * refused — a compromised renderer should not be able to use the OS as a
 * launcher for arbitrary URLs.
 */
const EXTERNAL_ALLOWLIST = [
  'https://github.com',
  'https://wa.me',
  'https://web.whatsapp.com',
  'https://faq.whatsapp.com',
  'https://platform.openai.com',
]

function isAllowedExternal(url: string): boolean {
  return EXTERNAL_ALLOWLIST.some(
    (prefix) => url.startsWith(`${prefix}/`) || url === prefix,
  )
}

/**
 * Hashes of the inline scripts Next emitted at build time, pinned by
 * scripts/copy-renderer.mjs.
 *
 * This is what lets script-src stay strict. The App Router emits inline
 * bootstrap scripts that `'self'` alone blocks; the alternatives were
 * 'unsafe-inline' — which would permit *any* injected script — or per-request
 * nonces, which a static export cannot produce. Hashing fails closed: an inline
 * script that was not in the build will not run.
 */
function inlineScriptHashes(rendererRoot: string): string[] {
  const file = join(rendererRoot, 'csp-script-hashes.json')
  if (!existsSync(file)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed)
      ? parsed.filter((h): h is string => typeof h === 'string')
      : []
  } catch (err) {
    console.error('security: could not read CSP script hashes', err)
    return []
  }
}

/**
 * Content Security Policy for the renderer.
 *
 * 'unsafe-inline' for styles is accepted: Next injects critical CSS inline, and
 * style injection is not a script-execution vector here — the renderer renders
 * no user-supplied HTML.
 *
 * connect-src stays 'self' because the renderer never talks to the network. All
 * outbound calls (license server, OpenAI, WhatsApp) happen in main or
 * wa-service, which is what keeps API keys out of the renderer entirely.
 *
 * 'unsafe-eval' is deliberately never granted.
 */
function buildCsp(scriptHashes: string[]): string {
  const scriptSrc = ["'self'", ...scriptHashes.map((h) => `'${h}'`)].join(' ')
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `media-src 'self' blob:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `frame-src 'none'`,
    `worker-src 'self' blob:`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-ancestors 'none'`,
  ].join('; ')
}

export function applySessionSecurity(rendererRoot: string): void {
  const ses = session.defaultSession
  const csp = buildCsp(inlineScriptHashes(rendererRoot))

  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    })
  })

  // The app needs no web permissions at all. Denying by default means a future
  // dependency cannot quietly prompt the user for a camera or their location.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}

/** Navigation and window-open policy for a specific window. */
export function applyWindowSecurity(
  win: BrowserWindow,
  rendererUrl: string | undefined,
): void {
  const origin = rendererUrl ?? APP_ORIGIN

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault()
      if (isAllowedExternal(url)) void shell.openExternal(url)
    }
  })

  // Nothing in this app embeds third-party content.
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

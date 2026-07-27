/**
 * Serves the Next.js static export over a custom `app://` scheme.
 *
 * WHY not file://: the export references assets with absolute paths
 * (/_next/static/...), which under file:// resolve to the filesystem root and
 * 404. Relative assetPrefix would fix the root page but break nested routes
 * (/campaigns/ would look for /campaigns/_next/...), and the app has nine.
 *
 * A custom scheme also gives the renderer a real, stable origin, which is what
 * makes a strict CSP and normal fetch semantics possible at all.
 */
import { net, protocol } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://bundle`

/**
 * Must run before app.whenReady(). Marking the scheme `standard` gives it
 * ordinary URL parsing and a proper origin; `secure` puts it on par with https
 * so browser security features are not silently downgraded.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

/** Must run after app.whenReady(). */
export function serveRendererBundle(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)

    // Strip the leading slash, default to the SPA entry point.
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (relative === '') relative = 'index.html'

    // Contain the resolved path inside the bundle. Without this, a crafted
    // request like app://bundle/../../etc/passwd would escape the app.
    const resolved = normalize(join(rendererRoot, relative))
    if (!resolved.startsWith(rendererRoot + sep) && resolved !== rendererRoot) {
      return new Response('Forbidden', { status: 403 })
    }

    // trailingSlash: true means routes are emitted as <route>/index.html.
    let target = resolved
    if (existsSync(target) && statSync(target).isDirectory()) {
      target = join(target, 'index.html')
    }
    if (!existsSync(target)) {
      const withIndex = join(resolved, 'index.html')
      if (existsSync(withIndex)) {
        target = withIndex
      } else {
        return new Response('Not found', { status: 404 })
      }
    }

    return net.fetch(pathToFileURL(target).toString())
  })
}

/**
 * Where the static export lives. scripts/copy-renderer.mjs puts it at
 * out/renderer in both unpackaged and packaged builds, so one path serves both.
 */
export function rendererRoot(dirname: string): string {
  return normalize(join(dirname, '../renderer'))
}

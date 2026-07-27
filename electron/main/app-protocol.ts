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
import { basename, dirname, join, normalize, sep } from 'node:path'
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
        const flattened = resolveFlattenedSegment(dirname(resolved), basename(resolved))
        if (flattened) {
          target = flattened
        } else {
          // Logged rather than silent: a 404 here means the renderer asked for
          // something the export does not contain, which is always a bug in the
          // build or this handler.
          console.warn(`app-protocol 404: ${url.pathname} -> ${resolved}`)
          return new Response('Not found', { status: 404 })
        }
      }
    }

    return net.fetch(pathToFileURL(target).toString())
  })
}

/**
 * Resolve a dot-flattened RSC payload request to its nested file on disk.
 *
 * Next's static export writes route-segment payloads into nested directories
 * (`devices/__next.!KGFwcCk/devices/__PAGE__.txt`) but the client router
 * requests them with the segments flattened into one filename
 * (`devices/__next.!KGFwcCk.devices.__PAGE__.txt`). Without this every
 * client-side navigation 404s its payload — navigation still works, because
 * Next falls back to a full document load, which is exactly why the bug is easy
 * to miss: the symptom is console noise plus lost prefetching.
 *
 * Recursive because nesting depth varies: a route group adds a level, and a
 * deeper route adds more. At each step it takes the longest dot-prefix that
 * names a real directory and resolves the remainder inside it.
 */
function resolveFlattenedSegment(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null

  const direct = join(dir, name)
  if (existsSync(direct) && statSync(direct).isFile()) return direct

  const parts = name.split('.')
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const prefix = parts.slice(0, i).join('.')
    const rest = parts.slice(i).join('.')
    const candidateDir = join(dir, prefix)
    if (existsSync(candidateDir) && statSync(candidateDir).isDirectory()) {
      const found = resolveFlattenedSegment(candidateDir, rest)
      if (found) return found
    }
  }
  return null
}

/**
 * Where the static export lives. scripts/copy-renderer.mjs puts it at
 * out/renderer in both unpackaged and packaged builds, so one path serves both.
 */
export function rendererRoot(dirname: string): string {
  return normalize(join(dirname, '../renderer'))
}

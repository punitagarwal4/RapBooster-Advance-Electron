/**
 * Copy the Next.js static export into out/renderer and pin its inline-script
 * hashes for the CSP.
 *
 * WHY the copy: main loads the renderer with join(__dirname, '../renderer/…'),
 * which resolves to out/renderer from out/main. Next cannot export outside its
 * own directory. Doing this here rather than in electron-builder means the
 * unpackaged build (what E2E drives) and the packaged build share one layout —
 * otherwise tests would exercise a path the shipped app never takes.
 *
 * WHY the hashes: the App Router emits inline bootstrap scripts
 * (self.__next_f.push(...)) that a strict `script-src 'self'` blocks. The
 * alternatives are 'unsafe-inline' — which would permit *any* injected script —
 * or per-request nonces, which a static export cannot produce. Hashing the exact
 * scripts we shipped keeps the policy strict and fails closed: an inline script
 * that was not in the build simply will not run.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'renderer/out'
const DEST = 'out/renderer'
const HASH_FILE = join(DEST, 'csp-script-hashes.json')

if (!existsSync(SRC)) {
  console.error(`copy-renderer: ${SRC} not found — run "next build renderer" first`)
  process.exit(1)
}

rmSync(DEST, { recursive: true, force: true })
cpSync(SRC, DEST, { recursive: true })

if (!existsSync(join(DEST, 'index.html'))) {
  console.error(`copy-renderer: ${DEST}/index.html missing after copy`)
  process.exit(1)
}

/** Every .html file in the export, at any depth (routes emit <route>/index.html). */
function htmlFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full))
    else if (entry.endsWith('.html')) out.push(full)
  }
  return out
}

// Matches <script> blocks with no src attribute — i.e. inline ones.
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi

const hashes = new Set()
for (const file of htmlFiles(DEST)) {
  const html = readFileSync(file, 'utf8')
  for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
    if (body.length === 0) continue
    // The CSP hash covers the element's exact text content, byte for byte.
    hashes.add(`sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`)
  }
}

writeFileSync(HASH_FILE, JSON.stringify([...hashes].sort(), null, 2))

console.log(`copy-renderer: ${SRC} -> ${DEST} (${hashes.size} inline-script hashes pinned)`)

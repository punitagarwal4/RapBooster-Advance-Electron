/**
 * Guards Baileys' image-thumbnail dependency.
 *
 * The bug this exists to prevent, in full, because it is subtle:
 *
 * Baileys needs an image library to build the `jpegThumbnail` on image
 * messages. It declares `sharp` and `jimp` as *peer* dependencies and resolves
 * whichever is present at runtime. Peer dependencies are installed at the npm
 * root during development, so everything worked locally — but electron-builder
 * packages by walking the production dependency graph from OUR package.json,
 * and a peer dependency of a dependency is not reachable that way. So sharp was
 * present in dev and absent from every packaged build.
 *
 * The failure is silent. `prepareWAMessageMedia` wraps thumbnail generation in
 * a try/catch that only logs at debug level, so image sends still "succeed" —
 * they just go out with no thumbnail and no width/height, which recipients see
 * as a grey placeholder until they tap to download. Nothing fails, nothing is
 * logged at a level anyone reads, and the mock transport used by E2E never
 * builds real media, so no test could have caught it.
 *
 * The fix is to declare sharp as a direct production dependency of this app,
 * which is what makes electron-builder ship it.
 *
 * Why sharp and not jimp: Baileys 7.0.0-rc13's `extractImageThumb` gates the
 * jimp branch on `typeof lib.jimp?.Jimp === 'object'`, but jimp@1.6.1 exports
 * `Jimp` as a function — so that branch is unreachable and jimp silently does
 * nothing. (The same file's `generateProfilePicture` checks for `'function'`,
 * which is the inconsistency.) Verified by hiding sharp and watching the call
 * throw with jimp installed. If a later Baileys release fixes that check, jimp
 * becomes the better choice — pure JS, no native binary, no libvips CVEs.
 *
 * sharp is pinned to an exact version at or above 0.35.0: everything below it
 * inherits the libvips CVEs (GHSA-f88m-g3jw-g9cj).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'


const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`MEDIA DEPS FAILED: ${message}`)
  process.exit(1)
}

// 1. Declared by us — this is the part that decides whether it ships at all.
//    A functional check alone would pass on a hoisted peer install and let the
//    original bug straight through.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const declared = pkg.dependencies?.sharp
if (!declared) {
  fail(
    'sharp is not a direct production dependency. Baileys only declares it as a peer, ' +
      'so electron-builder will not package it and every image will send without a thumbnail. ' +
      'Fix: npm install sharp@0.35.3 --save-exact',
  )
}
if (/^[\^~]/.test(declared)) {
  fail(`sharp must be pinned exactly, got "${declared}" (see CLAUDE.md on pinning native deps)`)
}

// 2. Above the libvips advisory floor. Read from disk rather than
//    require('sharp/package.json') — sharp 0.35 removed that subpath from its
//    "exports" map.
let installed
try {
  installed = JSON.parse(readFileSync(join(root, 'node_modules/sharp/package.json'), 'utf8')).version
} catch {
  fail('sharp is declared but not installed — run npm ci')
}
const [major, minor] = installed.split('.').map(Number)
if (major === 0 && minor < 35) {
  fail(`sharp ${installed} inherits the libvips CVEs; 0.35.0 or newer is required`)
}
if (installed !== declared) {
  fail(`sharp declared ${declared} but ${installed} is installed — run npm ci`)
}

// 3. Functional, through the real Baileys entry point rather than sharp
//    directly, so an API drift on either side is caught.
const { extractImageThumb } = await import('baileys/lib/Utils/messages-media.js').catch((err) =>
  fail(`cannot load baileys media utils: ${err.message}`),
)

const source = readFileSync(join(root, 'assets/branding/icon.png'))

let result
try {
  result = await extractImageThumb(source, 32)
} catch (err) {
  fail(`Baileys cannot generate image thumbnails: ${err.message}`)
}

const { buffer, original } = result
if (!buffer?.length) fail('thumbnail buffer was empty')
// 0xFFD8 is the JPEG SOI marker. Baileys base64s this straight into the
// message as jpegThumbnail, so it genuinely has to be a JPEG.
if (buffer[0] !== 0xff || buffer[1] !== 0xd8) fail('thumbnail is not a JPEG')
if (original?.width !== 1024 || original?.height !== 1024) {
  fail(`source dimensions wrong: ${JSON.stringify(original)} (expected 1024x1024)`)
}

console.log(
  `media deps OK — sharp ${installed} (declared), ${buffer.length}-byte JPEG thumb, ` +
    `source ${original.width}x${original.height}`,
)

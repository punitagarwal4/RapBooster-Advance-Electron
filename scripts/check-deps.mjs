/**
 * Dependency-integrity gate.
 *
 * Baileys resolves several libraries at runtime with `import(...)` inside a
 * try/catch, and treats every one of them as optional. When one is missing the
 * feature silently degrades: no exception reaches us, nothing fails a build,
 * and the only trace is a debug-level log inside Baileys. Two of these have
 * already bitten this project (tracker D55, D59), so the rule here is that
 * every optional peer must be *consciously triaged* — either declared by us
 * and proven to work, or recorded as deliberately absent with a reason.
 *
 * The important part is the last check: if a Baileys upgrade introduces a NEW
 * optional peer, this fails. Otherwise a version bump can silently add a whole
 * new degraded-feature surface, which is exactly how D55 happened.
 *
 * Run as part of `npm run verify`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

function fail(message) {
  problems.push(message)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const baileys = JSON.parse(
  readFileSync(join(root, 'node_modules/baileys/package.json'), 'utf8'),
)

/**
 * Every optional peer Baileys declares, and our decision on each.
 *
 * `required: true` means we declare it ourselves. Declaring it is what makes
 * electron-builder package it — a peer of a dependency is not reachable from
 * our own production dependency graph, so it would exist in dev and in no
 * shipped build.
 */
const TRIAGE = {
  sharp: {
    required: true,
    minor: 35, // below 0.35.0 inherits the libvips CVEs (GHSA-f88m-g3jw-g9cj)
    why: 'Generates the jpegThumbnail and width/height on every image message. Without it images send as a grey placeholder. See D55.',
  },
  jimp: {
    required: false,
    why: "Baileys 7.0.0-rc13 gates its jimp branch on `typeof lib.jimp?.Jimp === 'object'` but jimp@1.6.1 exports a function, so the branch is unreachable. sharp covers this path. See D56.",
  },
  'audio-decode': {
    required: false,
    why: 'Only used for audio waveform and duration. This app sends image and video only — asserted below against shared/types.ts.',
  },
  'link-preview-js': {
    required: false,
    why: 'Deliberately absent: Baileys fetches the preview once per message with no cache (its own TODO), so a 50k campaign would make 50k requests to the linked site from the user IP. Pending a decision in REQUIREMENTS §7.10. See D59.',
  },
}

const declaredPeers = Object.keys(baileys.peerDependencies ?? {})

// 1. Every peer Baileys declares must have been triaged here.
for (const peer of declaredPeers) {
  if (!(peer in TRIAGE)) {
    fail(
      `Baileys declares an optional peer this project has never triaged: "${peer}".\n` +
        `    Baileys resolves it with a swallowed dynamic import, so if a feature needs it,\n` +
        `    that feature is silently degraded right now. Decide whether we need it, then add\n` +
        `    it to TRIAGE in this file with the reasoning.`,
    )
  }
}

// 2. Anything we triaged that Baileys no longer declares is stale.
for (const name of Object.keys(TRIAGE)) {
  if (!declaredPeers.includes(name)) {
    fail(
      `TRIAGE lists "${name}" but Baileys no longer declares it — remove the stale entry.`,
    )
  }
}

// 3. Everything marked required must be declared by us, pinned, and installed.
for (const [name, rule] of Object.entries(TRIAGE)) {
  if (!rule.required) continue

  const declared = pkg.dependencies?.[name]
  if (!declared) {
    fail(
      `"${name}" is required but is not one of our production dependencies.\n` +
        `    Baileys declares it only as a peer, so electron-builder will not package it.\n` +
        `    Why it matters: ${rule.why}`,
    )
    continue
  }
  if (/^[\^~]/.test(declared)) {
    fail(
      `"${name}" must be pinned exactly, got "${declared}" — native deps must not move under a packaged build.`,
    )
  }

  let installed
  try {
    installed = JSON.parse(
      readFileSync(join(root, `node_modules/${name}/package.json`), 'utf8'),
    ).version
  } catch {
    fail(`"${name}" is declared but not installed — run npm ci.`)
    continue
  }
  if (installed !== declared) {
    fail(`"${name}" declared ${declared} but ${installed} is installed — run npm ci.`)
  }
  if (rule.minor !== undefined) {
    const [major, minor] = installed.split('.').map(Number)
    if (major === 0 && minor < rule.minor) {
      fail(`"${name}" ${installed} is below the required 0.${rule.minor}.0 floor.`)
    }
  }
}

// 4. The audio-decode reasoning depends on us never sending audio. Assert that
//    rather than trusting the comment — if someone adds 'audio' to the media
//    enum, this forces the peer to be re-triaged instead of silently shipping
//    audio messages with no waveform or duration.
const types = readFileSync(join(root, 'shared/types.ts'), 'utf8')
const mediaEnum = types.match(/export const mediaType = z\.enum\(\[([^\]]*)\]\)/)
if (!mediaEnum) {
  fail(
    'Could not find the mediaType enum in shared/types.ts — the audio-decode triage cannot be verified.',
  )
} else {
  const values = mediaEnum[1]
    .split(',')
    .map((v) => v.trim().replace(/['"]/g, ''))
    .filter(Boolean)
  const unexpected = values.filter((v) => !['image', 'video'].includes(v))
  if (unexpected.length > 0) {
    fail(
      `mediaType now includes ${unexpected.map((v) => `"${v}"`).join(', ')}.\n` +
        `    The "audio-decode" triage assumed image and video only. Audio messages need it for\n` +
        `    waveform and duration, and Baileys degrades silently without it. Re-triage.`,
    )
  }
}

// 5. Functional check, through the real Baileys entry point rather than sharp
//    directly, so an API drift on either side is caught. A declaration check
//    alone would pass on a hoisted peer install and let D55 straight through;
//    a functional check alone would pass in dev and ship broken.
if (problems.length === 0) {
  const { extractImageThumb } = await import('baileys/lib/Utils/messages-media.js').catch(
    (err) => {
      fail(`cannot load baileys media utils: ${err.message}`)
      return {}
    },
  )

  if (extractImageThumb) {
    try {
      const source = readFileSync(join(root, 'assets/branding/icon.png'))
      const { buffer, original } = await extractImageThumb(source, 32)
      // 0xFFD8 is the JPEG SOI marker. Baileys base64s this straight into the
      // message as jpegThumbnail, so it genuinely has to be a JPEG.
      if (!buffer?.length) fail('thumbnail buffer was empty')
      else if (buffer[0] !== 0xff || buffer[1] !== 0xd8) fail('thumbnail is not a JPEG')
      else if (original?.width !== 1024 || original?.height !== 1024) {
        fail(`source dimensions wrong: ${JSON.stringify(original)} (expected 1024x1024)`)
      }
    } catch (err) {
      fail(`Baileys cannot generate image thumbnails: ${err.message}`)
    }
  }
}

if (problems.length > 0) {
  console.error('DEPENDENCY CHECK FAILED\n')
  for (const p of problems) console.error(`  - ${p}\n`)
  process.exit(1)
}

const required = Object.entries(TRIAGE)
  .filter(([, r]) => r.required)
  .map(([n]) => n)
const absent = Object.entries(TRIAGE)
  .filter(([, r]) => !r.required)
  .map(([n]) => n)
console.log(
  `deps OK — ${declaredPeers.length} baileys peers triaged ` +
    `(shipped: ${required.join(', ')} · deliberately absent: ${absent.join(', ')})`,
)

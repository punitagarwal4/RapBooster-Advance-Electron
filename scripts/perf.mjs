/**
 * Startup + memory measurement against the PACKAGED build (SPRINTS.md T4.6).
 *
 * Run after `npm run pack`. Dev-mode numbers are meaningless here: the dev
 * renderer is served by the Next dev server with no minification, and the main
 * bundle is unminified with sourcemaps. Only the packaged build tells you what
 * a user experiences.
 *
 * Startup is measured cold and warm separately, because they differ by an order
 * of magnitude on Windows — the first launch after a build pays for SmartScreen
 * evaluation, AV scanning of a new binary, and a cold file cache. Reporting a
 * single averaged number would hide both.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const RUNS = 5

function findBinary() {
  const candidates = [
    join(DIST, 'win-unpacked', 'RapBooster Advance.exe'),
    join(DIST, 'mac', 'RapBooster Advance.app', 'Contents', 'MacOS', 'RapBooster Advance'),
    join(DIST, 'mac-arm64', 'RapBooster Advance.app', 'Contents', 'MacOS', 'RapBooster Advance'),
    join(DIST, 'linux-unpacked', 'rapbooster-advance'),
  ]
  const found = candidates.find((c) => existsSync(c))
  if (!found) {
    const listing = existsSync(DIST) ? readdirSync(DIST).join(', ') : '(no dist/)'
    throw new Error(`No packaged binary found. dist contains: ${listing}`)
  }
  return found
}

const binary = findBinary()
console.log(`perf: ${binary}\n`)

// --- Startup ---------------------------------------------------------------
// --self-test exits as soon as the database boot path completes, so it measures
// process start → app ready → DB ready. That is the part we control; it
// excludes renderer paint, which is measured separately below.
const timings = []
for (let i = 0; i < RUNS; i++) {
  const started = performance.now()
  try {
    execFileSync(binary, ['--self-test'], { encoding: 'utf8', timeout: 120_000, windowsHide: true })
  } catch (err) {
    console.error(`startup run ${i + 1} failed: ${err.message}`)
    process.exit(1)
  }
  timings.push(performance.now() - started)
}

const cold = timings[0]
const warm = timings.slice(1)
const mean = warm.reduce((a, b) => a + b, 0) / warm.length
const best = Math.min(...warm)
const worst = Math.max(...warm)

console.log('STARTUP (process start → app ready → database ready)')
console.log(`  cold (first launch): ${cold.toFixed(0)} ms`)
console.log(`  warm mean over ${warm.length}: ${mean.toFixed(0)} ms  [${best.toFixed(0)}–${worst.toFixed(0)} ms]`)
console.log(`  all runs: ${timings.map((t) => t.toFixed(0)).join(', ')} ms\n`)

// --- Memory ----------------------------------------------------------------
// Resident set of the whole process tree — Electron spawns a main process, a
// GPU process, a renderer and our wa-service utility process, and only the sum
// tells you what the machine actually gives up.
function treeRssMb() {
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$ErrorActionPreference='SilentlyContinue';` +
          `Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*RapBooster*' } | ` +
          `Measure-Object -Property WorkingSetSize -Sum | Select-Object -ExpandProperty Sum`,
      ],
      { encoding: 'utf8', timeout: 30_000, windowsHide: true },
    )
    const bytes = Number(out.trim())
    return Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 / 1024 : null
  } catch {
    return null
  }
}

console.log('MEMORY (resident set, all RapBooster processes)')

const child = spawn(binary, [], {
  env: {
    ...process.env,
    // Licensed + mock transport so the app reaches a steady idle state without
    // a real WhatsApp connection or a license server.
    RB_E2E: '1',
    WA_TRANSPORT: 'mock',
  },
  windowsHide: true,
  stdio: 'ignore',
})

const samples = []
const SAMPLE_MS = 3000
const DURATION_MS = 30_000

await new Promise((resolve) => setTimeout(resolve, 6000)) // let it finish booting

const timer = setInterval(() => {
  const mb = treeRssMb()
  if (mb !== null) samples.push(mb)
}, SAMPLE_MS)

await new Promise((resolve) => setTimeout(resolve, DURATION_MS))
clearInterval(timer)
child.kill()

if (samples.length === 0) {
  console.log('  (not measured — Windows-only, or the process exited early)')
} else {
  const first = samples[0]
  const last = samples[samples.length - 1]
  const peak = Math.max(...samples)
  console.log(`  after boot: ${first.toFixed(0)} MB`)
  console.log(`  after ${(DURATION_MS / 1000).toFixed(0)}s idle: ${last.toFixed(0)} MB`)
  console.log(`  peak: ${peak.toFixed(0)} MB`)
  console.log(`  drift: ${(last - first >= 0 ? '+' : '') + (last - first).toFixed(1)} MB`)
  console.log(`  samples: ${samples.map((s) => s.toFixed(0)).join(', ')} MB`)
}

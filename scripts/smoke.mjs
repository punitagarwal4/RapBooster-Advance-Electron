/**
 * Packaged-build smoke test (SPRINTS.md §13.4).
 *
 * WHY this runs every sprint and not just at release: native-module loading and
 * asar layout break in ways that no dev-mode test reproduces. Run after
 * `electron-builder --dir`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'

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
console.log(`smoke: ${binary}`)

let output
try {
  output = execFileSync(binary, ['--self-test'], {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
} catch (err) {
  console.error(err.stdout ?? '')
  console.error(err.stderr ?? '')
  console.error(`SMOKE FAILED — self-test exited ${err.status ?? 'abnormally'}`)
  process.exit(1)
}

console.log(output)

if (!output.includes('SPIKE PASSED')) {
  console.error('SMOKE FAILED — self-test did not report success')
  process.exit(1)
}
if (!output.includes('packaged: true')) {
  console.error('SMOKE FAILED — binary did not report itself as packaged')
  process.exit(1)
}

console.log('SMOKE PASSED')

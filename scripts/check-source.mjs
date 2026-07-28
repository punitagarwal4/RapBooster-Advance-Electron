/**
 * Source hygiene gate.
 *
 * Rejects control characters that have no business in source files. This is
 * not style policing — it exists because of a real defect.
 *
 * `electron/wa-service/transport/baileys.ts` was committed containing a raw
 * NUL byte inside a string literal, used as a never-match sentinel
 * (`own ?? '\0'` written with the actual byte rather than the escape). It
 * compiled, passed typecheck, passed lint, passed 81 E2E tests and shipped in a
 * packaged build. But a single NUL makes the whole file *binary* to grep,
 * ripgrep and `git diff` — so the file silently dropped out of every codebase
 * search, and the bug living on that same line went unfound for four sprints.
 *
 * Prettier and ESLint both pass such a file through untouched, so nothing in
 * the existing toolchain catches it.
 *
 * Written escapes such as '\0' and '\t' are fine and unaffected — this rejects
 * only the raw bytes, which are invisible in every editor.
 *
 * ESLint's `no-irregular-whitespace` does not cover this: NUL is not
 * whitespace, so that rule passes the exact byte that caused the problem.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Control characters that are never legitimate in our source, by code point.
 * Tab (0x09), newline (0x0A) and carriage return (0x0D) are deliberately absent.
 */
function offendingByte(code) {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false
  // C0 controls plus DEL.
  return code < 0x20 || code === 0x7f
}

const NAMES = {
  0x00: 'NUL',
  0x07: 'BEL',
  0x08: 'BACKSPACE',
  0x0b: 'VERTICAL TAB',
  0x0c: 'FORM FEED',
  0x1b: 'ESC',
  0x7f: 'DEL',
}

let files
try {
  files = execFileSync(
    'git',
    [
      'ls-files',
      '*.ts',
      '*.tsx',
      '*.mjs',
      '*.js',
      '*.json',
      '*.jsonc',
      '*.md',
      '*.css',
      '*.yml',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
} catch (err) {
  console.error(`SOURCE CHECK FAILED: could not list tracked files — ${err.message}`)
  process.exit(1)
}

const problems = []

for (const file of files) {
  let buf
  try {
    buf = readFileSync(file)
  } catch {
    // Listed by git but absent from the working tree (e.g. a partial checkout).
    // Not this check's job to complain about that.
    continue
  }

  for (let i = 0; i < buf.length; i += 1) {
    if (!offendingByte(buf[i])) continue

    // Report the position a human can act on, not a byte offset.
    const line = buf.subarray(0, i).toString('utf8').split('\n').length
    const name = NAMES[buf[i]] ?? `0x${buf[i].toString(16).padStart(2, '0')}`
    problems.push(
      `${file}:${line} contains a raw ${name} byte. ` +
        `It is invisible in editors and makes the file binary to grep and git diff. ` +
        `If the character is intended, write it as an escape (e.g. '\\0') instead.`,
    )
    break // one report per file is enough to act on
  }
}

if (problems.length > 0) {
  console.error('SOURCE CHECK FAILED\n')
  for (const p of problems) console.error(`  - ${p}\n`)
  process.exit(1)
}

console.log(`source OK — ${files.length} tracked files, no raw control characters`)

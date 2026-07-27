/**
 * Copy the Next.js static export into out/renderer.
 *
 * WHY: main loads the renderer with join(__dirname, '../renderer/index.html'),
 * which resolves to out/renderer from out/main. Next has no config for exporting
 * outside its own project directory, so the build copies it. Doing this here
 * rather than in electron-builder means the unpackaged build (what E2E drives)
 * and the packaged build share one layout — otherwise tests would exercise a
 * path the shipped app never takes.
 */
import { cpSync, existsSync, rmSync } from 'node:fs'

const SRC = 'renderer/out'
const DEST = 'out/renderer'

if (!existsSync(SRC)) {
  console.error(`copy-renderer: ${SRC} not found — run "next build renderer" first`)
  process.exit(1)
}

rmSync(DEST, { recursive: true, force: true })
cpSync(SRC, DEST, { recursive: true })

if (!existsSync(`${DEST}/index.html`)) {
  console.error(`copy-renderer: ${DEST}/index.html missing after copy`)
  process.exit(1)
}

console.log(`copy-renderer: ${SRC} -> ${DEST}`)

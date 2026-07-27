/**
 * Main process entry.
 *
 * The full boot sequence — logger → integrity check → backup → migrate →
 * settings → license gate → window — lands in T1.3/T1.8. This currently does
 * the minimum needed to prove the renderer load path in both dev and packaged
 * builds.
 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import {
  APP_ORIGIN,
  registerAppScheme,
  rendererRoot,
  serveRendererBundle,
} from './app-protocol'

app.setName('RapBooster Advance')

// Privileged scheme registration must happen before the app is ready.
registerAppScheme()

/**
 * electron-vite sets ELECTRON_RENDERER_URL when a dev server is running. Its
 * absence means "load the static export from disk" — which is what the packaged
 * app does and what E2E drives, so tests exercise the real production path
 * rather than a dev-only one.
 */
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f5f5f5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // CLAUDE.md §2.1 — the renderer never touches Node.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Nothing may navigate the shell away from the app, and nothing may spawn a
  // second window. External links open in the user's real browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const origin = RENDERER_URL ?? APP_ORIGIN
    if (!url.startsWith(origin)) event.preventDefault()
  })

  void win.loadURL(RENDERER_URL ?? `${APP_ORIGIN}/index.html`)
}

async function bootUi(): Promise<void> {
  // A second launch should focus the running window, not start a rival instance
  // that would contend for the same SQLite file.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  await app.whenReady()

  // Only needed when serving the static export; in dev the Vite/Next server does it.
  if (RENDERER_URL === undefined) {
    serveRendererBundle(rendererRoot(__dirname))
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

// `--self-test` runs the headless database/packaging probe instead of opening a
// window. This is how the packaged build is verified (SPRINTS.md §13.4) —
// native modules and asar layout only break in a real packaged binary.
if (process.argv.includes('--self-test')) {
  void import('./spike')
} else {
  void bootUi()
}

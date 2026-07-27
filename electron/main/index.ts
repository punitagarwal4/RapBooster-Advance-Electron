/**
 * Main process entry.
 *
 * Boot order: scheme registration → single-instance lock → ready → session
 * security → database (integrity/backup/migrate) → IPC handlers → renderer
 * protocol → window. The license gate joins between database and window in
 * T1.8; the logger replaces console in T1.10.
 */
import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import {
  APP_ORIGIN,
  registerAppScheme,
  rendererRoot,
  serveRendererBundle,
} from './app-protocol'
import { bootDatabase } from './db/boot'
import { checkpoint, disconnectPrisma } from './db/client'
import { registerLicenseHandlers } from './ipc/license.ipc'
import { registerSystemHandlers } from './ipc/system.ipc'
import { setLicenseGate, unregisteredChannels } from './ipc/router'
import {
  isUnlocked,
  loadLicense,
  revalidate,
  REVALIDATE_INTERVAL_MS,
} from './services/license/manager'
import { applySessionSecurity, applyWindowSecurity } from './security'

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

let mainWindow: BrowserWindow | undefined

/** Entry route for the current license state — the gate. */
function entryRoute(): string {
  return isUnlocked() ? 'index.html' : 'activation/index.html'
}

/**
 * Swap the window between the activation screen and the application without
 * recreating it, so activating feels immediate rather than flashing a new
 * window.
 */
export function refreshGate(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const target = RENDERER_URL
    ? `${RENDERER_URL}/${entryRoute()}`
    : `${APP_ORIGIN}/${entryRoute()}`
  void mainWindow.loadURL(target)
}

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
  applyWindowSecurity(win, RENDERER_URL)
  mainWindow = win

  void win.loadURL(
    RENDERER_URL ? `${RENDERER_URL}/${entryRoute()}` : `${APP_ORIGIN}/${entryRoute()}`,
  )
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

  // In dev the Next server serves the renderer, so there is no export to hash;
  // the CSP falls back to plain 'self' and dev inline scripts are expected to
  // be reported. Production is the strict case and is what E2E exercises.
  applySessionSecurity(rendererRoot(__dirname))

  // The database must be migrated before any window can query it. A failure
  // here is fatal and must be visible — starting with an unmigrated database
  // would fail later in ways that look like application bugs.
  try {
    const report = await bootDatabase()
    if (report.recovered) {
      console.warn(
        `database was corrupt and has been quarantined to ${report.integrity.quarantinedTo}`,
      )
    }
    if (report.migrations.applied.length > 0) {
      console.log(`applied migrations: ${report.migrations.applied.join(', ')}`)
    }
  } catch (err) {
    console.error('FATAL: database boot failed', err)
    dialog.showErrorBox(
      'RapBooster Advance could not start',
      `The local database could not be prepared.\n\n${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    app.exit(1)
    return
  }

  // Read the stored license before anything decides which screen to show.
  await loadLicense()
  setLicenseGate(isUnlocked)

  // Handlers must exist before the window can issue its first invoke.
  registerLicenseHandlers(refreshGate)
  registerSystemHandlers()
  const pending = unregisteredChannels()
  if (pending.length > 0) {
    // Expected during Sprint 1–4: the contract is fixed up front and handlers
    // land per sprint. Logged so an accidentally-dropped handler is visible
    // rather than surfacing as a mystery timeout in the UI.
    console.log(`ipc: ${pending.length} channel(s) not yet implemented`)
  }

  // Only needed when serving the static export; in dev the Vite/Next server does it.
  if (RENDERER_URL === undefined) {
    serveRendererBundle(rendererRoot(__dirname))
  }

  createWindow()

  // Background revalidation (REQUIREMENTS §1.6, assumption A1). A network
  // failure moves to grace rather than locking the user out; an explicit
  // rejection takes effect immediately and swaps the window back to activation.
  if (isUnlocked()) {
    setInterval(() => {
      void revalidate()
        .then(refreshGate)
        .catch((err) => console.error('license revalidation failed', err))
    }, REVALIDATE_INTERVAL_MS)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Graceful shutdown (CLAUDE.md §5.5): release the client and fold the WAL back
  // into the database so the next launch starts clean.
  app.on('before-quit', () => {
    void disconnectPrisma()
      .then(() => checkpoint())
      .catch((err) => console.error('shutdown: checkpoint failed', err))
  })
}

// `--self-test` runs the headless database/packaging probe instead of opening a
// window. This is how the packaged build is verified (SPRINTS.md §13.4) —
// native modules and asar layout only break in a real packaged binary.
if (process.argv.includes('--self-test')) {
  void import('./self-test')
} else {
  void bootUi()
}

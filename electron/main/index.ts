/**
 * Main process entry.
 *
 * Boot order: app name → logger + crash handlers → scheme registration →
 * single-instance lock → ready → session security → database
 * (integrity/backup/migrate) → license load + gate → IPC handlers → renderer
 * protocol → window.
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
import { registerCampaignHandlers } from './ipc/campaign.ipc'
import { persistIncoming, registerChatHandlers } from './ipc/chat.ipc'
import { registerChatbotHandlers } from './ipc/chatbot.ipc'
import { registerContactHandlers } from './ipc/contact.ipc'
import { registerDeviceHandlers, recoverDeviceSessions } from './ipc/device.ipc'
import { registerGroupHandlers } from './ipc/group.ipc'
import { registerLicenseHandlers } from './ipc/license.ipc'
import { registerSettingsHandlers } from './ipc/settings.ipc'
import { registerSystemHandlers } from './ipc/system.ipc'
import { registerTemplateHandlers } from './ipc/template.ipc'
import { emitToAll } from './ipc/router'
import { waBridge } from './wa-bridge'
import { campaignEngine } from './services/campaign-engine'
import { groupRunner } from './services/group-runner'
import { maybeReply } from './services/ai/responder'
import { getPrisma } from './db/client'
import { setLicenseGate, unregisteredChannels } from './ipc/router'
import {
  isUnlocked,
  loadLicense,
  revalidate,
  REVALIDATE_INTERVAL_MS,
} from './services/license/manager'
import { applySessionSecurity, applyWindowSecurity } from './security'
import { initLogger, installCrashHandlers } from './services/logger'
import { initUpdater } from './services/updater'

// The app name determines the userData path, so it must be set before the
// logger resolves its file location — otherwise logs land under "Electron".
app.setName('RapBooster Advance')

// Then logging, before anything else can fail: every subsequent console call is
// captured and redacted rather than escaping to a bare terminal.
initLogger()
installCrashHandlers()

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

/** The route the window is currently showing, so we only reload on a change. */
let loadedRoute: string | undefined

/**
 * Swap the window between the activation screen and the application without
 * recreating it, so activating feels immediate rather than flashing a new
 * window.
 *
 * No-ops when the lock state has not changed. Reloading unconditionally would
 * destroy renderer state on every routine revalidation — the user would lose
 * their place, and any in-flight UI (a toast, an open dialog, typed input)
 * would vanish for no reason.
 */
export function refreshGate(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const route = entryRoute()
  if (route === loadedRoute) return
  loadedRoute = route

  const target = RENDERER_URL ? `${RENDERER_URL}/${route}` : `${APP_ORIGIN}/${route}`
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

  const route = entryRoute()
  loadedRoute = route
  void win.loadURL(RENDERER_URL ? `${RENDERER_URL}/${route}` : `${APP_ORIGIN}/${route}`)
}

/**
 * Start wa-service and wire its events into the database and the renderer.
 *
 * Every device state change is persisted here, because wa-service holds no
 * database handle. The renderer learns about changes through push events, so
 * nothing polls for connection status.
 */
function startWaService(): void {
  const windows = () => BrowserWindow.getAllWindows()

  waBridge.setStateListener((state, restartCount) => {
    emitToAll(windows(), 'wa:serviceState', { state, restartCount })
    if (state === 'restarting') {
      emitToAll(windows(), 'toast', {
        level: 'warning',
        message: 'The WhatsApp service restarted. Reconnecting devices…',
      })
    }
  })

  // Devices first, then campaigns: a campaign cannot send through a socket
  // that has not been re-opened yet.
  waBridge.setRecoveryHook(async () => {
    await recoverDeviceSessions()
    const { requeued, resumed } = await campaignEngine.recover()
    if (requeued > 0 || resumed.length > 0) {
      console.log(
        `campaign recovery: requeued ${requeued} in-flight recipient(s), resumed ${resumed.length} campaign(s)`,
      )
    }
  })

  groupRunner.onProgress((p) => {
    emitToAll(windows(), "groupJob:progress", p)
  })

  campaignEngine.onProgress((campaignId, c) => {
    emitToAll(windows(), 'campaign:progress', {
      campaignId,
      status: 'running',
      sent: c.sent,
      failed: c.failed,
      total: c.total,
    })
  })

  waBridge.on('status', ({ deviceId, status, phone, error }) => {
    void getPrisma()
      .device.update({
        where: { id: deviceId },
        data: {
          status,
          ...(phone ? { phone } : {}),
          ...(error !== undefined ? { lastError: error } : {}),
          ...(status === 'connected' ? { lastActiveAt: new Date(), consecutiveFailures: 0 } : {}),
        },
      })
      .catch((err: unknown) => console.error(`could not persist status for ${deviceId}`, err))

    emitToAll(windows(), 'device:status', {
      deviceId,
      status,
      phone: phone ?? null,
      error: error ?? null,
    })

    // A device that drops mid-campaign would otherwise strand its slice of the
    // queue until it came back, and the campaign would look stalled.
    if (status === 'disconnected' || status === 'logged_out' || status === 'banned') {
      void campaignEngine
        .reassignFrom(deviceId)
        .then(({ moved, paused }) => {
          if (moved > 0) {
            emitToAll(windows(), 'toast', {
              level: 'warning',
              message: `A device disconnected. ${moved} pending message(s) moved to other devices.`,
            })
          }
          for (const _ of paused) {
            emitToAll(windows(), 'toast', {
              level: 'error',
              message: 'A campaign paused: no connected device is available to send.',
            })
          }
        })
        .catch((err: unknown) => console.error('reassignment failed', err))
    }
  })

  waBridge.on('qr', ({ deviceId, qr }) => {
    emitToAll(windows(), 'device:qr', { deviceId, qr })
  })

  waBridge.on('pairingCode', ({ deviceId, code }) => {
    emitToAll(windows(), 'device:pairingCode', { deviceId, code })
  })

  waBridge.on('giveUp', ({ deviceId, attempts }) => {
    void getPrisma()
      .device.update({ where: { id: deviceId }, data: { consecutiveFailures: attempts } })
      .catch(() => {
        // Non-fatal: the counter is diagnostic, the toast is what matters.
      })
    emitToAll(windows(), 'toast', {
      level: 'error',
      message: `A device stopped reconnecting after ${attempts} attempts. Open Devices to retry.`,
    })
  })

  waBridge.on('message', ({ deviceId, message }) => {
    void persistIncoming(deviceId, message)
      .then((saved) => {
        // Null means the id was already known — WhatsApp redelivers on
        // reconnect, and showing the same message twice looks like a bug.
        if (!saved) return
        emitToAll(windows(), 'message:received', { chatId: saved.chatId, message: saved })

        // Auto-reply runs after the message is stored and shown, so the user
        // sees the inbound message immediately rather than after the model.
        void maybeReply(deviceId, saved.chatId, { body: saved.body, isGroup: message.isGroup })
          .then((outcome) => {
            if (outcome.kind === 'failed') {
              // Never a silent no-op: the user configured auto-reply, and if it
              // is not happening they need to know exactly why.
              console.error(`auto-reply failed [${outcome.code}] ${outcome.message}`)
              emitToAll(windows(), 'toast', { level: 'error', message: outcome.message })
            } else if (outcome.kind === 'escalated') {
              emitToAll(windows(), 'toast', { level: 'warning', message: 'A conversation was escalated for a human reply.' })
            }
          })
          .catch((err) => console.error('auto-reply threw', err))
      })
      .catch((err: unknown) => console.error('could not persist incoming message', err))
  })

  waBridge.on('receipt', ({ messageId, status }) => {
    void getPrisma()
      .message.update({ where: { id: messageId }, data: { status } })
      .then(() => emitToAll(windows(), 'message:status', { messageId, status }))
      .catch(() => {
        // A receipt for a message we never stored (sent before this install,
        // or from another linked device) is not an error.
      })
  })

  waBridge.on('log', ({ level, message }) => {
    if (level === 'error') console.error(`[wa-service] ${message}`)
    else if (level === 'warn') console.warn(`[wa-service] ${message}`)
    else console.log(`[wa-service] ${message}`)
  })

  waBridge.start()

  // Scheduler tick. One minute is enough granularity for a datetime-local
  // field, and comparing against the wall clock means a machine that slept
  // through a scheduled time still fires on wake.
  setInterval(() => {
    void campaignEngine
      .runScheduled()
      .then((started) => {
        if (started.length > 0) {
          console.log(`scheduler: started ${started.length} campaign(s)`)
        }
      })
      .catch((err: unknown) => console.error("scheduler tick failed", err))
  }, 60_000)
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
  registerDeviceHandlers()
  registerContactHandlers()
  registerTemplateHandlers()
  registerCampaignHandlers()
  registerGroupHandlers()
  registerChatHandlers()
  registerChatbotHandlers()
  registerSettingsHandlers()

  startWaService()
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

  // Updates: wired against the feed from REQUIREMENTS §3. Until that is
  // supplied the feed is a placeholder and checks report "not configured"
  // rather than pretending the app is up to date.
  initUpdater(() => BrowserWindow.getAllWindows())

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
    // Close sockets before releasing the database, so nothing tries to persist
    // after the client is gone.
    void campaignEngine
      .shutdown()
      .then(() => waBridge.stop())
      .catch((err) => console.error('shutdown: wa-service stop failed', err))
      .then(() => disconnectPrisma())
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

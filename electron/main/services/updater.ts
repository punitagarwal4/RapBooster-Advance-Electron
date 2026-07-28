/**
 * Auto-update (SPRINTS.md §12.1 T4.5).
 *
 * ⚠ WIRED BUT UNVERIFIED. The feed URL comes from REQUIREMENTS §3, which is not
 * yet answered, so the configured default points at an unreachable placeholder.
 * Everything below is real code on the real electron-updater API — but nobody
 * has watched it install an update, and it cannot be end-to-end tested until a
 * feed exists and builds are signed (§4). Treated as done only when that has
 * actually happened.
 *
 * Update checks are deliberately manual-plus-startup rather than aggressive:
 * this app runs long campaigns, and restarting under someone mid-send would be
 * worse than being a version behind.
 */
import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/** Placeholder until REQUIREMENTS §3 supplies the real one (assumption A3). */
const PLACEHOLDER_FEED = 'https://updates.example.invalid/rapbooster/'

export interface UpdateState {
  available: boolean
  version: string | null
  /** True when no real feed is configured, so the UI can say so honestly. */
  unconfigured: boolean
}

let lastState: UpdateState = { available: false, version: null, unconfigured: true }

function feedUrl(): string {
  return process.env.UPDATE_FEED_URL?.trim() || PLACEHOLDER_FEED
}

export function isConfigured(): boolean {
  return !feedUrl().includes('example.invalid')
}

export function initUpdater(getWindows: () => BrowserWindow[]): void {
  // An unpackaged build has no update path, and electron-updater throws rather
  // than no-oping if asked to check.
  if (!app.isPackaged) {
    lastState = { available: false, version: null, unconfigured: true }
    return
  }

  autoUpdater.autoDownload = false
  // Never install under a running campaign without the user choosing to.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl() })

  autoUpdater.on('update-available', (info) => {
    lastState = { available: true, version: info.version, unconfigured: false }
    for (const win of getWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('toast', {
          level: 'info',
          message: `Version ${info.version} is available. Open Settings to install it.`,
        })
      }
    }
  })

  autoUpdater.on('update-not-available', () => {
    lastState = { available: false, version: null, unconfigured: false }
  })

  autoUpdater.on('error', (err) => {
    // A failed update check must never be fatal — the app works fine on the
    // version it already has.
    console.error('updater error', err)
  })

  autoUpdater.on('update-downloaded', (info) => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('toast', {
          level: 'success',
          message: `Version ${info.version} is ready. It will install when you quit.`,
        })
      }
    }
    autoUpdater.autoInstallOnAppQuit = true
  })
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) {
    return { available: false, version: null, unconfigured: true }
  }
  if (!isConfigured()) {
    // Saying "no updates" when no feed is configured would be a lie.
    return { available: false, version: null, unconfigured: true }
  }

  try {
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version ?? null
    lastState = {
      available: version !== null && version !== app.getVersion(),
      version,
      unconfigured: false,
    }
  } catch (err) {
    console.error('update check failed', err)
  }
  return lastState
}

export async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged || !isConfigured()) return
  await autoUpdater.downloadUpdate()
}

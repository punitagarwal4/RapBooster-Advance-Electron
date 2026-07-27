/**
 * Main process entry.
 *
 * Placeholder for T1.1 (the packaging spike drives the build right now).
 * The real boot sequence — logger → integrity check → backup → migrate →
 * settings → license gate → window — lands in T1.3.
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

app.setName('RapBooster Advance')

// `--self-test` runs the headless database/packaging probe instead of opening a
// window. This is how the packaged build is verified in CI (SPRINTS.md §13.4) —
// native modules and asar layout only break in a real packaged binary.
if (process.argv.includes('--self-test')) {
  void import('./spike')
} else {
  void bootUi()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.loadURL('data:text/html,<h1>RapBooster Advance</h1><p>Sprint 1 in progress.</p>')
}

async function bootUi(): Promise<void> {
  await app.whenReady()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

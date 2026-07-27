/**
 * Preload. The only bridge between renderer and main.
 *
 * Placeholder for T1.1. The typed, channel-allowlisted `window.api` surface
 * defined by shared/ipc.ts lands in T1.5.
 */
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {
  version: process.versions.electron,
})

import type { RapBoosterApi } from '../../electron/preload'

declare global {
  interface Window {
    api: RapBoosterApi
  }
}

export {}

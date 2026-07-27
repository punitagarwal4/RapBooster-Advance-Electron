import { AppError } from '../../../shared/errors'
import {
  activate,
  deactivate,
  getCached,
  loadLicense,
  revalidate,
  transfer,
} from '../services/license/manager'
import { registerHandler } from './router'

/**
 * @param onChange invoked whenever the lock state may have changed, so the
 *   window can swap between the activation screen and the application.
 */
export function registerLicenseHandlers(onChange: () => void): void {
  registerHandler('license:status', async () => loadLicense())

  registerHandler('license:activate', async ({ key, remarks }) => {
    const result = await activate(key, remarks)
    if (result.status === 'valid') onChange()
    return { status: result.status, info: result.info, conflict: result.conflict }
  })

  registerHandler('license:transfer', async ({ key, remarks }) => {
    const result = await transfer(key, remarks)
    if (result.status === 'conflict') {
      // The server refused the transfer it had just offered — surfacing this as
      // a conflict again would loop the user through the same dialog.
      throw new AppError('LICENSE_CONFLICT', {
        userMessage: 'The license could not be moved to this computer. Please try again.',
      })
    }
    if (result.status === 'valid') onChange()
    return { status: result.status, info: result.info }
  })

  registerHandler('license:deactivate', async () => {
    await deactivate()
    onChange()
    return { ok: true as const }
  })

  registerHandler('license:revalidate', async () => {
    const info = await revalidate()
    onChange()
    return info
  })
}

/** Read-only accessor for the gate and the IPC guard. */
export { getCached as cachedLicense }

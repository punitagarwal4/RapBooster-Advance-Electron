/**
 * Domain string unions (SPRINTS.md §4.1).
 *
 * SQLite has no native enums, so these are the single source of truth for every
 * status value in the system. They are declared as zod schemas rather than bare
 * TypeScript unions because every value crossing the IPC boundary must be
 * validated at runtime — a compile-time union proves nothing about data read
 * back out of the database or received from WhatsApp.
 */
import { z } from 'zod'

export const licenseStatus = z.enum([
  'unlicensed',
  'valid',
  'invalid',
  'expired',
  'revoked',
  'conflict',
  'grace',
])
export type LicenseStatus = z.infer<typeof licenseStatus>

export const deviceStatus = z.enum([
  'disconnected',
  'connecting',
  'qr_pending',
  'pairing_pending',
  'connected',
  'logged_out',
  'banned',
])
export type DeviceStatus = z.infer<typeof deviceStatus>

export const campaignStatus = z.enum([
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
  'failed',
])
export type CampaignStatus = z.infer<typeof campaignStatus>

export const recipientStatus = z.enum(['pending', 'sending', 'sent', 'failed', 'skipped'])
export type RecipientStatus = z.infer<typeof recipientStatus>

export const templateType = z.enum(['text', 'media', 'interactive', 'button'])
export type TemplateType = z.infer<typeof templateType>

export const mediaType = z.enum(['image', 'video'])
export type MediaType = z.infer<typeof mediaType>

export const messageDirection = z.enum(['in', 'out'])
export type MessageDirection = z.infer<typeof messageDirection>

export const messageType = z.enum([
  'text',
  'media',
  'attachment',
  'buttons',
  'interactive',
])
export type MessageType = z.infer<typeof messageType>

export const messageStatus = z.enum(['pending', 'sent', 'delivered', 'read', 'failed'])
export type MessageStatus = z.infer<typeof messageStatus>

export const jobStatus = z.enum(['pending', 'running', 'paused', 'completed', 'failed'])
export type JobStatus = z.infer<typeof jobStatus>

export const suffixRule = z.enum(['number', 'alphabet', 'timestamp', 'none'])
export type SuffixRule = z.infer<typeof suffixRule>

export const waServiceState = z.enum(['starting', 'up', 'restarting', 'down'])
export type WaServiceState = z.infer<typeof waServiceState>

/**
 * An international dial prefix, e.g. `+91`.
 *
 * There is deliberately no default (REQUIREMENTS §7.5): the importer asks per
 * file whether the numbers already carry a country code, because normalizing a
 * whole list against a guessed country is only discoverable after the messages
 * have gone to the wrong people.
 */
export const dialPrefix = z
  .string()
  .regex(/^\+[1-9]\d{0,3}$/, 'A dial prefix looks like +91')
export type DialPrefix = z.infer<typeof dialPrefix>

/** Mandatory columns every contact list begins with (SPRINTS.md §2.6). */
export const REQUIRED_CONTACT_FIELDS = ['Name', 'Mobile'] as const

/**
 * The button kinds a template can carry (REQUIREMENTS §7.9).
 *
 * `reply` sends the label back as a message; `url` opens a link; `call` dials a
 * number; `copy` copies text to the recipient's clipboard. Catalogue-based
 * shapes (product, shop, carousel) are deliberately out of scope — they need a
 * WhatsApp Business catalogue, which this product does not have.
 */
export const templateButtonType = z.enum(['reply', 'url', 'call', 'copy'])
export type TemplateButtonType = z.infer<typeof templateButtonType>

export const templateButton = z.object({
  type: templateButtonType,
  /** Shown on the button. WhatsApp truncates long labels on narrow screens. */
  label: z.string().min(1).max(25),
  /** URL for `url`, phone number for `call`, the copied string for `copy`. */
  value: z.string().max(2048).optional(),
})
export type TemplateButton = z.infer<typeof templateButton>

/**
 * Per-kind caps.
 *
 * WhatsApp itself enforces nothing here — Baileys will happily encode an
 * over-limit message and the server drops it silently, which is the worst
 * possible failure for a campaign. These are the conservative limits the
 * official Business templates use, applied at our own boundary so an
 * over-limit template is refused at creation rather than at send.
 */
export const MAX_TEMPLATE_BUTTONS = 5
export const MAX_REPLY_BUTTONS = 3
export const MAX_URL_BUTTONS = 2
export const MAX_CALL_BUTTONS = 1
export const MAX_COPY_BUTTONS = 1
/** Rows in an interactive template's single-select list. */
export const MAX_LIST_ROWS = 10

/** Concurrency ceiling for connected devices (SPRINTS.md §1.1). */
export const MAX_DEVICES = 20

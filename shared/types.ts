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

/** Mandatory columns every contact list begins with (SPRINTS.md §2.6). */
export const REQUIRED_CONTACT_FIELDS = ['Name', 'Mobile'] as const

/** WhatsApp permits at most three quick-reply buttons. */
export const MAX_TEMPLATE_BUTTONS = 3

/** Concurrency ceiling for connected devices (SPRINTS.md §1.1). */
export const MAX_DEVICES = 20

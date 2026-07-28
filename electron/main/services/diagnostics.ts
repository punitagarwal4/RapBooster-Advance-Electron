/**
 * Diagnostics bundle (CLAUDE.md §5.2).
 *
 * Produces a single file the user can send to support. Logs are already
 * redacted by the logger, and settings are filtered again here — a bundle is
 * the most likely artifact to leave the machine, so it gets the strictest
 * treatment.
 */
import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { getPrisma } from '../db/client'
import { databasePath, logsDir, userDataDir } from '../db/paths'
import { listBackups } from '../db/backup'
import { backupsDir } from '../db/paths'
import { redact } from './logger'

const SENSITIVE_SETTING = /key|token|secret|password/i

export async function buildDiagnostics(): Promise<string> {
  const exportsDir = join(userDataDir(), 'exports')
  mkdirSync(exportsDir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(exportsDir, `diagnostics-${stamp}.txt`)

  const sections: string[] = []

  sections.push(
    [
      '=== RapBooster Advance diagnostics ===',
      `generated: ${new Date().toISOString()}`,
      `app: ${app.getVersion()}`,
      `electron: ${process.versions.electron}`,
      `node: ${process.versions.node}`,
      `chrome: ${process.versions.chrome}`,
      `platform: ${process.platform}-${process.arch}`,
      `packaged: ${app.isPackaged}`,
    ].join('\n'),
  )

  // Database facts, never contents.
  try {
    const dbSize = existsSync(databasePath()) ? statSync(databasePath()).size : 0
    const prisma = getPrisma()
    const [devices, lists, contacts, templates, campaigns] = await Promise.all([
      prisma.device.count(),
      prisma.contactList.count(),
      prisma.contact.count(),
      prisma.template.count(),
      prisma.campaign.count(),
    ])
    sections.push(
      [
        '=== database ===',
        `size: ${dbSize} bytes`,
        `devices: ${devices}`,
        `lists: ${lists}`,
        `contacts: ${contacts}`,
        `templates: ${templates}`,
        `campaigns: ${campaigns}`,
        `backups: ${listBackups(backupsDir()).length}`,
      ].join('\n'),
    )
  } catch (err) {
    sections.push(`=== database ===\nunavailable: ${String(err)}`)
  }

  // Settings keys and whether they are set — never their values.
  try {
    const settings = await getPrisma().setting.findMany({
      select: { key: true, value: true },
    })
    const lines = settings.map((s) =>
      SENSITIVE_SETTING.test(s.key)
        ? `${s.key} = [set: ${s.value.length > 0}]`
        : `${s.key} = ${redact(s.value)}`,
    )
    sections.push(`=== settings ===\n${lines.join('\n') || '(none)'}`)
  } catch (err) {
    sections.push(`=== settings ===\nunavailable: ${String(err)}`)
  }

  // Recent log tail. Already redacted at write time; redacted again on the way
  // out because defence in depth costs nothing here.
  try {
    const dir = logsDir()
    const files = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.log'))
      : []
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf8')
      const tail = content.split('\n').slice(-400).join('\n')
      sections.push(`=== log: ${file} (last 400 lines) ===\n${redact(tail)}`)
    }
    if (files.length === 0) sections.push('=== logs ===\n(none)')
  } catch (err) {
    sections.push(`=== logs ===\nunavailable: ${String(err)}`)
  }

  writeFileSync(target, sections.join('\n\n'), 'utf8')
  return target
}

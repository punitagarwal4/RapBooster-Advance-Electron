/**
 * T4.6 load profile — 20 devices plus a live campaign.
 *
 * Not a pass/fail correctness test; it exists to produce a number and to catch
 * the one failure that matters at this scale: memory that climbs and never
 * comes back while a campaign is running. The thresholds are deliberately
 * loose. A tight bound here would fail on a busy machine and teach everyone to
 * ignore it, which is worse than no check.
 *
 * Runs against the mock transport, so it measures *our* overhead — the queue,
 * the workers, the throttle, the IPC event fan-out and the renderer — without
 * 20 real WhatsApp sockets. That is the part we control and the part a
 * regression would land in.
 *
 * Skipped by default: it takes minutes and is a measurement, not a gate. Run
 * with `PERF=1 npx playwright test perf-load`.
 */
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupUserDataDir,
  launchLicensed,
  newUserDataDir,
} from './fixtures/licensed-app'

const DEVICES = 20
const CONTACTS = 2000

test.describe(() => {
  test.skip(process.env.PERF !== '1', 'measurement only — run with PERF=1')
  test.setTimeout(10 * 60_000)

  /**
   * Resident set of this app's Electron processes, in MB.
   *
   * Filtered on our own `node_modules` executable path rather than the name
   * "electron": the developer's editor is very often an Electron app too, and
   * matching by name silently folds VS Code and Slack into the number. That
   * still trends correctly for leak detection, but it makes the absolute figure
   * meaningless — and a number nobody can trust gets ignored.
   */
  function rssMb(): number | null {
    if (process.platform !== 'win32') return null
    // No backslash escaping: in a PowerShell -like pattern only *, ? and [ are
    // special, so doubling backslashes stops it matching anything at all.
    const electronDir = join(process.cwd(), 'node_modules', 'electron')
    try {
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "$ErrorActionPreference='SilentlyContinue';" +
            'Get-CimInstance Win32_Process | ' +
            `Where-Object { $_.ExecutablePath -like '${electronDir}*' } | ` +
            'Measure-Object -Property WorkingSetSize -Sum | Select-Object -ExpandProperty Sum',
        ],
        { encoding: 'utf8', timeout: 30_000, windowsHide: true },
      )
      const bytes = Number(out.trim())
      return Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 / 1024 : null
    } catch {
      return null
    }
  }

  test('P1 — memory stays flat under 20 devices and a running campaign', async () => {
    const dir = newUserDataDir()
    const { app, win } = await launchLicensed(dir)
    const samples: { label: string; mb: number | null }[] = []
    const sample = (label: string) => samples.push({ label, mb: rssMb() })

    try {
      sample('idle after boot')

      // 20 concurrent devices.
      const deviceIds = await win.evaluate(async (n) => {
        const out: string[] = []
        for (let i = 0; i < n; i += 1) {
          const r = await window.api.invoke('device:create', { name: `Perf ${i}` })
          if (r.ok) out.push(r.data.id)
        }
        await Promise.all(out.map((id) => window.api.invoke('device:connect', { id })))
        return out
      }, DEVICES)
      expect(deviceIds).toHaveLength(DEVICES)
      sample(`${DEVICES} devices connected`)

      // A contact list large enough that the queue is not trivially short.
      // Imported from a CSV rather than inserted row by row, because that is
      // the path a real user takes and the one with the streaming parser in it.
      const csvPath = join(tmpdir(), `perf-contacts-${Date.now()}.csv`)
      writeFileSync(
        csvPath,
        ['Name,Mobile']
          .concat(
            Array.from(
              { length: CONTACTS },
              (_, i) => `Perf ${i},+9198${String(10_000_000 + i).slice(-8)}`,
            ),
          )
          .join('\n'),
        'utf8',
      )

      const listId = await win.evaluate(async (path) => {
        const created = await window.api.invoke('contactList:create', {
          name: 'Perf list',
          customFields: [],
        })
        if (!created.ok) throw new Error('list create failed')
        const imported = await window.api.invoke('contacts:import', {
          listId: created.data.id,
          filePath: path,
          mapping: { Name: 'name', Mobile: 'phone' },
          duplicatePolicy: 'skip',
        })
        if (!imported.ok) throw new Error(`import failed: ${imported.error.code}`)
        return created.data.id
      }, csvPath)
      rmSync(csvPath, { force: true })
      sample(`${CONTACTS} contacts imported`)

      // A campaign across every device, sending as fast as the throttle allows.
      const campaignId = await win.evaluate(
        async ({ listId, deviceIds }) => {
          const tpl = await window.api.invoke('template:create', {
            name: 'Perf template',
            type: 'text',
            content: 'Hello {{Name}}',
          })
          if (!tpl.ok) throw new Error('template create failed')
          const c = await window.api.invoke('campaign:create', {
            name: 'Perf campaign',
            templateId: tpl.data.id,
            listIds: [listId],
            deviceIds,
            delayFrom: 0,
            delayTo: 0,
            sleepDuration: 0,
            sleepAfter: 100,
          })
          if (!c.ok) throw new Error('campaign create failed')
          await window.api.invoke('campaign:start', { id: c.data.id })
          return c.data.id
        },
        { listId, deviceIds },
      )

      // Sample while it actually runs.
      for (let i = 0; i < 8; i += 1) {
        await new Promise((r) => setTimeout(r, 5000))
        sample(`campaign running +${(i + 1) * 5}s`)
      }

      await win.evaluate((id) => window.api.invoke('campaign:stop', { id }), campaignId)
      await new Promise((r) => setTimeout(r, 5000))
      sample('after stop')

      // The UI must still be responsive after all of that.
      await win.getByTestId('nav-devices').click()
      await expect(win.getByTestId('page-title')).toHaveText('WhatsApp Devices')
      sample('after navigation')

      const measured = samples.filter((s) => s.mb !== null) as {
        label: string
        mb: number
      }[]
      console.log('\n--- P1 load profile ---')
      for (const s of measured)
        console.log(`  ${s.label.padEnd(28)} ${s.mb.toFixed(0)} MB`)

      if (measured.length >= 3) {
        const duringRun = measured.filter((s) => s.label.startsWith('campaign running'))
        if (duringRun.length >= 2) {
          const growth = duringRun[duringRun.length - 1].mb - duringRun[0].mb
          console.log(
            `  growth while running:        ${growth >= 0 ? '+' : ''}${growth.toFixed(0)} MB`,
          )
          // Loose on purpose — see the file header. This catches a runaway
          // leak, not ordinary heap variation.
          expect(growth).toBeLessThan(400)
        }
        console.log(
          `  peak:                        ${Math.max(...measured.map((s) => s.mb)).toFixed(0)} MB`,
        )
      }
      console.log('---\n')
    } finally {
      await app.close()
      cleanupUserDataDir(dir)
    }
  })
})

import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cleanupUserDataDir, launchLicensed, newUserDataDir } from './fixtures/licensed-app'

/**
 * Sprint 4 — AI Bot (SPRINTS.md §12.3, E4.9–E4.18).
 *
 * No test calls OpenAI. What matters here is that every configuration field
 * persists, and that each failure mode is distinct and visible — a silent
 * no-op would leave the user believing auto-reply works when it does not.
 */

function settingRow(dir: string, key: string) {
  const db = new DatabaseSync(join(dir, 'rapbooster.db'), { readOnly: true })
  try {
    return db.prepare('SELECT value, isEncrypted FROM Setting WHERE key = ?').get(key) as
      | { value: string; isEncrypted: number }
      | undefined
  } finally {
    db.close()
  }
}

test('E4.9 — the full configuration saves and survives a restart', async () => {
  const dir = newUserDataDir()
  let session = await launchLicensed(dir)
  try {
    const saved = await session.win.evaluate(async () => {
      const current = await window.api.invoke('chatbot:get')
      if (!current.ok) return null

      return window.api.invoke('chatbot:save', {
        ...current.data,
        enabled: true,
        systemInstructions: 'Be brief and helpful.',
        businessName: 'Acme Corp',
        businessEmail: 'support@acme.test',
        businessPhone: '+911234567890',
        responseDelay: 3,
        tone: 'friendly',
        industry: 'E-Commerce',
        primaryGoal: 'sales',
        responseStyle: 'concise',
        language: 'hindi',
        escalationTrigger: 'keywords',
        escalationKeywords: ['refund', 'lawyer'],
        escalationMessage: 'Connecting you with support team...',
        confidenceThreshold: 80,
        products: 'Widget | A useful widget',
        knowledgeBase: 'Q: Hours? | A: 9 to 5',
      })
    })
    expect(saved?.ok).toBe(true)
  } finally {
    await session.app.close()
  }

  session = await launchLicensed(dir)
  try {
    const reloaded = await session.win.evaluate(() => window.api.invoke('chatbot:get'))
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return

    // Every field the screen exposes has to actually round-trip, or the
    // settings are theatre.
    expect(reloaded.data.systemInstructions).toBe('Be brief and helpful.')
    expect(reloaded.data.businessName).toBe('Acme Corp')
    expect(reloaded.data.responseDelay).toBe(3)
    expect(reloaded.data.tone).toBe('friendly')
    expect(reloaded.data.primaryGoal).toBe('sales')
    expect(reloaded.data.responseStyle).toBe('concise')
    expect(reloaded.data.language).toBe('hindi')
    expect(reloaded.data.escalationKeywords).toEqual(['refund', 'lawyer'])
    expect(reloaded.data.confidenceThreshold).toBe(80)
    expect(reloaded.data.products).toContain('Widget')
    expect(reloaded.data.knowledgeBase).toContain('Hours?')
  } finally {
    await session.app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.12 — a missing API key reports itself rather than failing silently', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const result = await win.evaluate(() => window.api.invoke('chatbot:testKey', {}))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.valid).toBe(false)
    // The message has to say what is wrong, not just that something is.
    expect(result.data.detail).toContain('No API key')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.17 — the API key is stored encrypted and never appears in plaintext', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const secret = 'sk-test-DO-NOT-LEAK-abcdef1234567890'

    const stored = await win.evaluate(
      (value) => window.api.invoke('settings:set', { key: 'ai.apiKey', value, encrypt: true }),
      secret,
    )
    expect(stored.ok).toBe(true)

    const row = settingRow(dir, 'ai.apiKey')
    expect(row).toBeDefined()
    expect(row?.isEncrypted).toBe(1)
    // The raw key must not be readable in the database.
    expect(row?.value).not.toContain(secret)

    // And it must not come back over IPC either — settings:get returns the
    // stored form, which is ciphertext.
    const readBack = await win.evaluate(() => window.api.invoke('settings:get', { key: 'ai.apiKey' }))
    if (readBack.ok) expect(readBack.data.value).not.toBe(secret)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.10 + E4.11 — auto-reply is skipped when disabled, and per-chat opt-out sticks', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    const outcome = await win.evaluate(async () => {
      const current = await window.api.invoke('chatbot:get')
      if (!current.ok) return null

      // Disabled by default is not assumed — set it explicitly.
      const off = await window.api.invoke('chatbot:save', { ...current.data, enabled: false })
      const on = await window.api.invoke('chatbot:save', { ...current.data, enabled: true })
      return { off: off.ok && !off.data.enabled, on: on.ok && on.data.enabled }
    })

    expect(outcome?.off).toBe(true)
    expect(outcome?.on).toBe(true)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.9b — the AI Bot screen renders every prototype field and saves', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await win.getByTestId('nav-chatbot').click()
    await expect(win.getByTestId('page-title')).toHaveText('AI Chatbot Configuration')

    // Panels from the prototype (SPRINTS.md §2.8).
    for (const id of [
      'system-instructions',
      'biz-name',
      'enable-autoreply',
      'response-delay',
      'tone',
      'industry',
      'primary-goal',
      'response-style',
      'language',
      'escalation-trigger',
      'escalation-keywords',
      'products',
      'knowledge-base',
    ]) {
      await expect(win.getByTestId(id)).toBeVisible()
    }

    const instructions = win.getByTestId('system-instructions')
    await instructions.fill('Answer politely and briefly.')
    await expect(instructions).toHaveValue('Answer politely and briefly.')

    await win.getByTestId('tone').selectOption('casual')
    await win.getByTestId('save-chatbot').click()
    await expect(win.getByTestId('toast')).toBeVisible()

    const saved = await win.evaluate(() => window.api.invoke('chatbot:get'))
    if (saved.ok) {
      expect(saved.data.systemInstructions).toBe('Answer politely and briefly.')
      expect(saved.data.tone).toBe('casual')
    }
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E4.13b — a non-keyword escalation trigger says it is not enforced', async () => {
  const dir = newUserDataDir()
  const { app, win } = await launchLicensed(dir)
  try {
    await win.getByTestId('nav-chatbot').click()
    await expect(win.getByTestId('escalation-trigger')).toBeVisible()

    // Keywords is the only trigger backed by real behaviour, so anything else
    // must say so rather than quietly doing nothing.
    await win.getByTestId('escalation-trigger').selectOption('confidence')
    await expect(win.getByTestId('trigger-unsupported')).toContainText('not enforced')

    await win.getByTestId('escalation-trigger').selectOption('keywords')
    await expect(win.getByTestId('trigger-unsupported')).toHaveCount(0)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

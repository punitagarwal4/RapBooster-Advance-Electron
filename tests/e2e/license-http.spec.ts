/**
 * The real HTTP license client, against a local stub server.
 *
 * Every other license spec runs against `MockLicenseService`, so until now
 * `services/license/http.ts` — the code that will run in production the day
 * REQUIREMENTS §1 is answered — had never been executed by anything. These
 * specs launch the app with `LICENSE_SERVICE` unset so the real client is
 * selected, and point `LICENSE_API_URL` at a stub we control.
 *
 * The behaviour under test is the one with the worst failure mode: what
 * happens to a paying customer when the license server misbehaves. A response
 * we cannot parse must never be read as "this licence is bad", because that
 * clears the activation and locks the user out of software they bought.
 */
import { expect, test, type Page } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { APP_READY_TIMEOUT_MS } from './fixtures/constants'
import { cleanupUserDataDir, newUserDataDir } from './fixtures/licensed-app'

/** What the stub should reply with next. Mutated per test. */
interface StubReply {
  status: number
  body: string
  contentType?: string
}

let server: Server
let baseUrl: string
let reply: StubReply
let requests: { path: string; body: string }[] = []

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      requests.push({ path: req.url ?? '', body: raw })
      res.writeHead(reply.status, {
        'Content-Type': reply.contentType ?? 'application/json',
      })
      res.end(reply.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test.beforeEach(() => {
  requests = []
})

async function launchAgainstStub(userDataDir: string): Promise<ElectronApplication> {
  const env = { ...process.env, LICENSE_API_URL: baseUrl, WA_TRANSPORT: 'mock' }
  // LICENSE_SERVICE must be absent, not empty — that is what selects
  // HttpLicenseService over the mock every other spec uses.
  delete env.LICENSE_SERVICE

  return electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userDataDir}`],
    env,
  })
}

async function tryActivate(win: Page, key: string): Promise<void> {
  const field = win.getByTestId('license-key')
  await field.waitFor({ state: 'visible', timeout: APP_READY_TIMEOUT_MS })
  await field.fill(key)
  await expect(field).toHaveValue(key)
  await win.getByTestId('license-activate').click()
}

test('E1.17 — the real client is used and sends the key and fingerprint', async () => {
  const dir = newUserDataDir()
  reply = {
    status: 200,
    body: JSON.stringify({ status: 'invalid', message: 'Unknown key' }),
  }
  const app = await launchAgainstStub(dir)
  try {
    const win = await app.firstWindow()
    await tryActivate(win, 'SOME-KEY-0001')

    // An explicit rejection must still be honoured immediately.
    await expect(win.getByTestId('license-error')).toBeVisible()

    // Pins the wire contract we are currently assuming (REQUIREMENTS §1.3),
    // so that when the real API is specified the difference shows up here as a
    // failing test rather than as a silent mismatch against a live server.
    expect(requests.length).toBeGreaterThan(0)
    expect(requests[0].path).toBe('/activate')

    const sent = JSON.parse(requests[0].body) as Record<string, unknown>
    expect(sent.key).toBe('SOME-KEY-0001')
    // The machine fingerprint travels as `device_id`, and is what binds an
    // activation to this computer.
    expect(typeof sent.device_id).toBe('string')
    expect((sent.device_id as string).length).toBeGreaterThan(0)
    expect(typeof sent.device_name).toBe('string')
    expect(typeof sent.app_version).toBe('string')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.18 — a 200 with an unparseable body does not report the key as invalid', async () => {
  const dir = newUserDataDir()
  // A CDN or captive portal returning an HTML error page with status 200 is the
  // realistic trigger, and it must not read as "your licence is bad".
  reply = {
    status: 200,
    body: '<html><body>503 Service Temporarily Unavailable</body></html>',
    contentType: 'text/html',
  }
  const app = await launchAgainstStub(dir)
  try {
    const win = await app.firstWindow()
    await tryActivate(win, 'SOME-KEY-0002')

    // Assert what the user is actually told. Checking `license:status` here
    // would prove nothing: activation persists no record on any non-valid
    // outcome, so the stored status reads the same either way. The message on
    // screen is the thing that differs, and the thing that sends the user off
    // to hunt for a typo in a key that is perfectly fine.
    const message = win.getByTestId('license-error')
    await expect(message).toBeVisible()
    await expect(message).toContainText(/could not reach the license server/i)
    await expect(message).not.toContainText(/invalid/i)
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.19 — rate limiting does not deactivate an activated machine', async () => {
  const dir = newUserDataDir()
  reply = {
    status: 200,
    body: JSON.stringify({ status: 'valid', expires_at: null, device_name: 'Stub PC' }),
  }
  const app = await launchAgainstStub(dir)
  try {
    const win = await app.firstWindow()
    await tryActivate(win, 'GOOD-KEY-0003')
    await win
      .getByTestId('nav-dashboard')
      .waitFor({ state: 'visible', timeout: APP_READY_TIMEOUT_MS })

    // Now the server starts rate-limiting, as it would during a revalidation
    // burst across many installs.
    reply = { status: 429, body: JSON.stringify({ error: 'too many requests' }) }

    const revalidated = await win.evaluate(() => window.api.invoke('license:revalidate'))
    expect(revalidated.ok).toBe(true)
    if (revalidated.ok) {
      // Grace, not invalid. A paying customer must not be locked out because
      // the licence server was busy.
      expect(revalidated.data.status).toBe('grace')
    }

    // And the application stays open rather than re-gating.
    await expect(win.getByTestId('nav-dashboard')).toBeVisible()
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.20 — a server error keeps the user working under grace', async () => {
  const dir = newUserDataDir()
  reply = {
    status: 200,
    body: JSON.stringify({ status: 'valid', expires_at: null, device_name: 'Stub PC' }),
  }
  const app = await launchAgainstStub(dir)
  try {
    const win = await app.firstWindow()
    await tryActivate(win, 'GOOD-KEY-0004')
    await win
      .getByTestId('nav-dashboard')
      .waitFor({ state: 'visible', timeout: APP_READY_TIMEOUT_MS })

    reply = { status: 500, body: 'internal error' }
    const revalidated = await win.evaluate(() => window.api.invoke('license:revalidate'))
    expect(revalidated.ok).toBe(true)
    if (revalidated.ok) expect(revalidated.data.status).toBe('grace')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

test('E1.21 — an explicit revocation is honoured immediately, not given grace', async () => {
  const dir = newUserDataDir()
  reply = {
    status: 200,
    body: JSON.stringify({ status: 'valid', expires_at: null, device_name: 'Stub PC' }),
  }
  const app = await launchAgainstStub(dir)
  try {
    const win = await app.firstWindow()
    await tryActivate(win, 'GOOD-KEY-0005')
    await win
      .getByTestId('nav-dashboard')
      .waitFor({ state: 'visible', timeout: APP_READY_TIMEOUT_MS })

    // The counterweight to E1.18–E1.20: erring toward grace must not mean the
    // server can never revoke. When it says so explicitly, that is final.
    reply = {
      status: 200,
      body: JSON.stringify({ status: 'revoked', message: 'Licence revoked' }),
    }
    const revalidated = await win.evaluate(() => window.api.invoke('license:revalidate'))
    expect(revalidated.ok).toBe(true)
    if (revalidated.ok) expect(revalidated.data.status).toBe('revoked')
  } finally {
    await app.close()
    cleanupUserDataDir(dir)
  }
})

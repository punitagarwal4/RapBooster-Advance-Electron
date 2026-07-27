import { defineConfig } from '@playwright/test'

/**
 * E2E runs against the real Electron app via _electron.launch() — not a mocked
 * DOM (CLAUDE.md §6). Each spec gets an isolated userData directory so tests
 * never share a database.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // one SQLite file per run; parallel Electron apps contend
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  /**
   * Generous on purpose. The first Electron launch of a run absorbs module
   * loading, Prisma initialisation and V8 warm-up, and several specs import
   * tens of thousands of rows. A tight budget here fails the first test of a
   * suite while it passes in isolation — cold start, not flakiness.
   */
  timeout: 180_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'electron', testMatch: /.*\.spec\.ts/ }],
})

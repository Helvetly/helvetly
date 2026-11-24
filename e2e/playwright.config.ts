import { defineConfig, devices } from '@playwright/test'

const port = '8008' // e2e/scripts/e2e-server.mjs
const portalPort = '8009'
const gracefulShutdown = { signal: 'SIGTERM', timeout: 15_000 } as const

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      url: `http://localhost:${port}/api/v1/auth/config`,
      timeout: 180_000,
      reuseExistingServer: false,
      gracefulShutdown,
    },
    {
      command: `pnpm exec next dev --port ${portalPort}`,
      cwd: '../apps/portal',
      env: {
        API_URL: 'http://127.0.0.1:3338',
        HELVETLY_E2E_NEXT_DIST: 'true',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      url: `http://localhost:${portalPort}/robots.txt`,
      reuseExistingServer: false,
      gracefulShutdown,
    },
  ],
})

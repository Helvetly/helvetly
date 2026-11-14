import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const directory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@': resolve(directory, 'src') },
    dedupe: ['vitest', '@vitest/runner', '@vitest/expect', '@vitest/spy', '@vitest/utils'],
  },
  optimizeDeps: {
    include: ['msw-storybook-addon/csf3'],
  },
  plugins: [storybookTest({ configDir: resolve(directory, '.storybook') })],
  test: {
    name: 'portal-storybook',
    // Keep browser and service-worker resources bounded as the screen suite grows.
    fileParallelism: false,
    maxWorkers: 1,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: 'chromium' } }),
      instances: [{ browser: 'chromium' }],
    },
    testTimeout: 20000,
  },
})

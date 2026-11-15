import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/i18n/vitest.config.ts',
      'apps/platform/vitest.config.ts',
      'apps/platform/vitest.storybook.config.ts',
      {
        extends: './apps/portal/vitest.config.ts',
        root: fileURLToPath(new URL('apps/portal', import.meta.url)),
        test: { name: 'portal-unit' },
      },
      'apps/portal/vitest.storybook.config.ts',
      {
        extends: './packages/ui/vitest.config.ts',
        root: fileURLToPath(new URL('packages/ui', import.meta.url)),
        test: { name: 'ui-unit' },
      },
      {
        extends: './apps/web/vitest.config.ts',
        root: fileURLToPath(new URL('apps/web', import.meta.url)),
        test: { name: 'web-unit' },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'apps/platform/src/**/*.{ts,tsx}',
        'apps/portal/src/**/*.{ts,tsx}',
        'packages/ui/src/**/*.{ts,tsx}',
        'packages/i18n/src/**/*.ts',
        'apps/web/src/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.test.*', '**/stories/**', '**/mocks/**', '**/test/**', '**/*.d.ts'],
    },
  },
})

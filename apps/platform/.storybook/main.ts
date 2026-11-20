import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/nextjs-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/nextjs-vite',
    // Explicit so the root coverage run (another cwd) still applies the app's trailingSlash etc.
    options: { nextConfigPath: fileURLToPath(new URL('../next.config.ts', import.meta.url)) },
  },
  // The MSW worker lives outside public/ so the production export never ships it.
  staticDirs: ['../public', './msw'],
  core: { disableTelemetry: true },
  viteFinal: (vite) => {
    vite.build ??= {}
    // A test bundle that is never served to users: Storybook's runtime and the stories are large chunks by nature.
    vite.build.chunkSizeWarningLimit = 2000
    vite.build.rolldownOptions ??= {}
    // The slow callbacks are react-docgen (the docs' prop tables) and Tailwind's CSS: both needed, so no report.
    vite.build.rolldownOptions.checks = {
      ...vite.build.rolldownOptions.checks,
      bundlerTimings: false,
    }
    // "use client" only matters to the Next.js app; Storybook's client-only bundle drops it by design.
    vite.build.rolldownOptions.onwarn = (warning, warn) => {
      if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning)
    }
    return vite
  },
}

export default config

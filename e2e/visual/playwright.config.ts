import { defineConfig } from '@playwright/test'

// Screenshot regression of built Storybooks, and the focus audit of every story (focus-layout.spec.ts). Run it
// through `bash e2e/visual/run.sh`: it runs inside the pinned Playwright Linux image, so baselines render the
// same on a Mac and in CI.
export default defineConfig({
  testDir: '.',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  outputDir: './test-results',
  // Large upload stories need memory headroom in the same Docker VM as the test services; a CI runner has
  // four cores and the suite to itself.
  workers: process.env.CI ? 4 : 2,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  expect: {
    // Exact pixels on the same image and fonts; a small tolerance only for anti-aliasing noise.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    locale: 'en-GB',
    timezoneId: 'Europe/Zurich',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:6612/index.json',
    reuseExistingServer: false,
  },
})

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Shared by every JS workspace: `export { default } from '@helvetly/vitest-config'`.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [import.meta.resolve('./setup.ts')],
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    // Whole-screen tests type through userEvent; with coverage on a shared CI runner they need more than the 5 s default.
    testTimeout: 15_000,
  },
})

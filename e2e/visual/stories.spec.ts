import { expect, test, type Page } from '@playwright/test'

const storybook = { platform: 'http://127.0.0.1:6611', portal: 'http://127.0.0.1:6612' }
type App = keyof typeof storybook

// Whole screens: desktop and phone, light and dark. Design-system stories: the story root, light and dark.
const screens: [App, string][] = [
  ['platform', 'pages-dashboard--with-data'],
  ['platform', 'pages-invoices--list'],
  ['platform', 'pages-clients--detail'],
  ['platform', 'pages-invoice-editor--draft-with-lines'],
  ['platform', 'pages-documents--folders-and-files'],
  ['portal', 'pages-portal--overview'],
  ['portal', 'pages-portal--profile'],
]
const components: [App, string][] = [
  ['platform', 'design-system-controls--button-variants'],
  ['platform', 'design-system-controls--button-sizes'],
  ['platform', 'design-system-controls--disabled-and-loading'],
  ['platform', 'design-system-controls--validation-error'],
  ['platform', 'design-system-controls--status-badges'],
  ['platform', 'design-system-components--callouts'],
  ['platform', 'design-system-components--meters'],
  ['platform', 'design-system-components--segmented-control'],
  ['platform', 'design-system-components--panel-and-empty-state'],
]
const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }
const themes = ['light', 'dark'] as const

// The sample data is relative to "now"; a fixed clock keeps dates, ages and greetings stable.
const now = new Date('2026-11-10T09:30:00+01:00')

async function open(page: Page, app: App, id: string, theme: (typeof themes)[number]) {
  await page.clock.setFixedTime(now)
  await page.goto(`${storybook[app]}/iframe.html?id=${id}&viewMode=story`)
  // Shoot only once the story has rendered and its play function (data, clicks) has finished.
  const phase = await page.waitForFunction(() => {
    // Storybook's own record of the render: preparing, loading, rendering, playing … completed.
    const preview: unknown = Reflect.get(window, '__STORYBOOK_PREVIEW__')
    const render: unknown =
      typeof preview === 'object' && preview ? Reflect.get(preview, 'currentRender') : undefined
    const current: unknown =
      typeof render === 'object' && render ? Reflect.get(render, 'phase') : undefined
    return typeof current === 'string' &&
      ['completed', 'finished', 'errored', 'aborted'].includes(current)
      ? current
      : undefined
  })
  expect(await phase.jsonValue()).not.toMatch(/errored|aborted/)
  await page.waitForLoadState('networkidle')
  // A spinner in view (Loader, row-level ones) means a value is still on its way. Below the fold, lazy
  // thumbnails keep theirs until scrolled to, by design.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-slot=loader], .animate-spin')].every(
      (spinner) => spinner.getBoundingClientRect().top >= window.innerHeight,
    ),
  )
  // The preview sets `dark` from the story's parameters; the dark shot flips the same story's tokens.
  await page.evaluate(
    (dark) => document.documentElement.classList.toggle('dark', dark),
    theme === 'dark',
  )
  // A baseline in a fallback font would hide every typography change, so a missing Inter fails loudly.
  expect(
    await page.evaluate(async () => (await document.fonts.load('14px Inter')).length),
  ).toBeGreaterThan(0)
  await page.evaluate(() => document.fonts.ready)
}

for (const [app, id] of screens) {
  for (const [size, viewport] of Object.entries(sizes)) {
    for (const theme of themes) {
      test(`${id} ${size} ${theme}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await open(page, app, id, theme)
        await expect(page).toHaveScreenshot(`${id}--${size}-${theme}.png`)
      })
    }
  }
}

for (const [app, id] of components) {
  for (const theme of themes) {
    test(`${id} ${theme}`, async ({ page }) => {
      await page.setViewportSize(sizes.desktop)
      await open(page, app, id, theme)
      // The story's own content plus a margin, not the whole min-h-screen frame around it.
      const clip = await page.evaluate(() => {
        const frame = document.querySelector('#storybook-root > *')
        const boxes = [...(frame?.children ?? [])].map((child) => child.getBoundingClientRect())
        const [left, top] = [
          Math.min(...boxes.map((b) => b.left)),
          Math.min(...boxes.map((b) => b.top)),
        ]
        const [right, bottom] = [
          Math.max(...boxes.map((b) => b.right)),
          Math.max(...boxes.map((b) => b.bottom)),
        ]
        const x = Math.max(0, Math.floor(left) - 12)
        const y = Math.max(0, Math.floor(top) - 12)
        return { x, y, width: Math.ceil(right) + 12 - x, height: Math.ceil(bottom) + 12 - y }
      })
      await expect(page).toHaveScreenshot(`${id}--${theme}.png`, { clip, fullPage: true })
    })
  }
}

test('with reduced motion a drawer appears in place, without sliding', async ({ page }) => {
  await page.setViewportSize(sizes.desktop)
  await open(page, 'platform', 'pages-clients--detail', 'light')
  const timing = await page.locator('[data-slot=sheet-content]').evaluate((drawer) => {
    const style = getComputedStyle(drawer)
    return [style.animationDuration, style.transitionDuration]
  })
  for (const duration of timing) expect(Number.parseFloat(duration)).toBeLessThan(0.001)
})

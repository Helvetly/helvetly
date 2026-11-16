import { expect, type Page } from '@playwright/test'

export const storybook = { platform: 'http://127.0.0.1:6611', portal: 'http://127.0.0.1:6612' }
export type App = keyof typeof storybook
export const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }

// The sample data is relative to "now"; a fixed clock keeps dates, ages and greetings stable.
const now = new Date('2026-11-10T09:30:00+01:00')

/**
 * Loads a story and waits until it has rendered and its play function (data, clicks) has finished. A
 * story of a pending state keeps its request open, so this does not wait for the network to go quiet.
 */
export async function render(page: Page, app: App, id: string) {
  await page.clock.setFixedTime(now)
  await page.goto(`${storybook[app]}/iframe.html?id=${id}&viewMode=story`)
  const phase = await page.waitForFunction(() => {
    // Storybook's own record of the render: preparing, loading, rendering, playing … completed.
    const preview: unknown = Reflect.get(window, '__STORYBOOK_PREVIEW__')
    const story: unknown =
      typeof preview === 'object' && preview ? Reflect.get(preview, 'currentRender') : undefined
    const current: unknown =
      typeof story === 'object' && story ? Reflect.get(story, 'phase') : undefined
    return typeof current === 'string' &&
      ['completed', 'finished', 'errored', 'aborted'].includes(current)
      ? current
      : undefined
  })
  expect(await phase.jsonValue()).not.toMatch(/errored|aborted/)
  await page.evaluate(() => document.fonts.ready)
}

/** A story ready to shoot: rendered, its data in view, in `theme`, in Inter. */
export async function open(page: Page, app: App, id: string, theme: 'light' | 'dark') {
  await render(page, app, id)
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

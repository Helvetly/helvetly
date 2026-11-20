import { errors, expect, type Page } from '@playwright/test'

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

/**
 * Clears what a play function's clicks leave behind (a focus ring, a hover tint), so the shot shows the
 * story at rest whatever the timing. A story whose baseline shows focus or hover on purpose sets
 * `parameters.visual.keepFocus`.
 */
async function atRest(page: Page) {
  const keepFocus = await page.evaluate(() => {
    const preview: unknown = Reflect.get(window, '__STORYBOOK_PREVIEW__')
    const story: unknown =
      typeof preview === 'object' && preview ? Reflect.get(preview, 'currentRender') : undefined
    const entry: unknown =
      typeof story === 'object' && story ? Reflect.get(story, 'story') : undefined
    const parameters: unknown =
      typeof entry === 'object' && entry ? Reflect.get(entry, 'parameters') : undefined
    const visual: unknown =
      typeof parameters === 'object' && parameters ? Reflect.get(parameters, 'visual') : undefined
    return typeof visual === 'object' && visual ? Reflect.get(visual, 'keepFocus') === true : false
  })
  if (keepFocus) return
  // Outside the viewport: no element is under the pointer.
  await page.mouse.move(-1, -1)
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  })
}

/**
 * Switches an open Storybook to another story of the same app without reloading it: the iframe, its 1.4 MB of
 * script and the mock worker stay, which makes a sweep over every story about three times faster than `render`.
 * What the last story left outside its own tree (focus, storage, a portal that outlived it) is cleared first,
 * and the new story counts as ready once its play function has finished and its DOM stopped changing (its
 * data arrives later than after a full load, which takes long enough to hide that).
 */
export async function switchStory(page: Page, id: string) {
  await page.evaluate((storyId) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    localStorage.clear()
    sessionStorage.clear()
    // Whatever sits next to the root now belongs to the story being left; Storybook's own boxes stay.
    const own = '#storybook-root, #storybook-docs, script, [class^="sb-"]'
    const leftovers = [...document.body.children].filter((child) => !child.matches(own))
    Reflect.set(window, 'storyLeftovers', leftovers)
    const preview: unknown = Reflect.get(window, '__STORYBOOK_PREVIEW__')
    const channel: unknown =
      typeof preview === 'object' && preview ? Reflect.get(preview, 'channel') : undefined
    const emit: unknown =
      typeof channel === 'object' && channel ? Reflect.get(channel, 'emit') : undefined
    if (typeof emit !== 'function') throw new Error('Storybook preview channel not found')
    Reflect.apply(emit, channel, ['setCurrentStory', { storyId, viewMode: 'story' }])
  }, id)
  const phase = await page.waitForFunction((storyId) => {
    const preview: unknown = Reflect.get(window, '__STORYBOOK_PREVIEW__')
    const story: unknown =
      typeof preview === 'object' && preview ? Reflect.get(preview, 'currentRender') : undefined
    const current: unknown =
      typeof story === 'object' && story ? Reflect.get(story, 'phase') : undefined
    const rendered: unknown =
      typeof story === 'object' && story ? Reflect.get(story, 'id') : undefined
    return rendered === storyId &&
      typeof current === 'string' &&
      ['completed', 'finished', 'errored', 'aborted'].includes(current)
      ? current
      : undefined
  }, id)
  expect(await phase.jsonValue()).not.toMatch(/errored|aborted/)
  await page.evaluate(async () => {
    const leftovers: unknown = Reflect.get(window, 'storyLeftovers')
    if (Array.isArray(leftovers))
      for (const node of leftovers) if (node instanceof Element) node.remove()
    window.scrollTo(0, 0)
    Reflect.set(window, 'storyShape', undefined)
    await document.fonts.ready
  })
  // Still for half a second; a story of a pending state never stops loading, so at most three seconds.
  await page
    .waitForFunction(
      () => {
        const root = document.querySelector('#storybook-root')
        const shape = `${root?.querySelectorAll('*').length}|${root?.textContent?.length}`
        const since: unknown = Reflect.get(window, 'storyShapeSince')
        if (shape !== Reflect.get(window, 'storyShape')) {
          Reflect.set(window, 'storyShape', shape)
          Reflect.set(window, 'storyShapeSince', Date.now())
          return false
        }
        return typeof since === 'number' && Date.now() - since >= 500
      },
      undefined,
      { polling: 100, timeout: 3000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof errors.TimeoutError)) throw error
    })
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
  await atRest(page)
  // A baseline in a fallback font would hide every typography change, so a missing Inter fails loudly.
  expect(
    await page.evaluate(async () => (await document.fonts.load('14px Inter')).length),
  ).toBeGreaterThan(0)
  await page.evaluate(() => document.fonts.ready)
}

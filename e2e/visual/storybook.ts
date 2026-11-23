import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, type Page } from '@playwright/test'

export const storybook = { platform: 'http://127.0.0.1:6611', portal: 'http://127.0.0.1:6612' }
export type App = keyof typeof storybook
export const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }

// On a pull request CI writes the stories its changes reach (scripts/visual-affected.mjs); without the file,
// every story.
const affectedFile = resolve(import.meta.dirname, 'affected.json')
const affected: unknown = existsSync(affectedFile)
  ? JSON.parse(readFileSync(affectedFile, 'utf8'))
  : undefined

// CI's shard of the suite, `<current>/<total>` (the whole suite without it). Playwright's own --shard cuts the
// test list into contiguous runs, so a stretch of slow stories (one page's many states) lands in one shard;
// dealing the cases round-robin spreads them over every shard.
const shardSpec = process.env.HELVETLY_VISUAL_SHARD || '1/1'
const [shardIndex = 0, shardCount = 0] = shardSpec.split('/').map(Number)
if (!(shardCount >= 1 && shardIndex >= 1 && shardIndex <= shardCount))
  throw new Error(`HELVETLY_VISUAL_SHARD must be <current>/<total>, not ${shardSpec}`)

/** This shard's share of `cases`: every `shardCount`-th, starting at `shardIndex`. */
export function shard<T>(cases: T[]) {
  return cases.filter((_, index) => index % shardCount === shardIndex - 1)
}

/** The light stories of `app` this run audits (this shard's share). */
export function stories(app: App) {
  const only = typeof affected === 'object' && affected ? Reflect.get(affected, app) : undefined
  const file = resolve(import.meta.dirname, `../../apps/${app}/storybook-static/index.json`)
  const index: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const entries = typeof index === 'object' && index ? Reflect.get(index, 'entries') : undefined
  const ids = Object.values(typeof entries === 'object' && entries ? entries : {}).flatMap(
    (entry: unknown) => {
      const id = typeof entry === 'object' && entry ? Reflect.get(entry, 'id') : undefined
      const type = typeof entry === 'object' && entry ? Reflect.get(entry, 'type') : undefined
      // A dark variant lays out exactly like its light story.
      return type === 'story' &&
        typeof id === 'string' &&
        !id.endsWith('-dark') &&
        (!Array.isArray(only) || only.includes(id))
        ? [id]
        : []
    },
  )
  return shard(ids)
}

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

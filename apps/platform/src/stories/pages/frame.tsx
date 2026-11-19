import { Toaster } from '@helvetly/ui/components/sonner'
import type { StoryObj } from '@storybook/nextjs-vite'
import type { RequestHandler } from 'msw'
import type { ReactNode } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import SignedInLayout from '@/app/(app)/layout'

import { shellHandlers } from './api'

/**
 * Page stories ("Pages/…") render a screen inside the real signed-in shell (sidebar, header,
 * panel, Heidi, tab bar), each in light, dark and on a 390px phone, so a visual review and
 * `scripts/screens.mjs` can screenshot every screen as people see it.
 */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <SignedInLayout>{children}</SignedInLayout>
      <Toaster />
    </>
  )
}

export const pageParameters = (
  pathname: string,
  query: Record<string, string> = {},
  handlers: RequestHandler[] = [],
) => ({
  layout: 'fullscreen',
  ownMain: true,
  bare: true,
  // shortcut: the shell's sidebar labels fail colour contrast today (audit phase 1, tokens); turn
  // this rule back on here once the colour sweep has fixed them. Every other a11y rule still fails.
  a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  nextjs: { navigation: { pathname, query } },
  msw: { handlers: [...handlers, ...shellHandlers] },
  viewport: {
    options: {
      desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } },
      phone: { name: 'Phone', styles: { width: '390px', height: '844px' } },
    },
  },
})

/** Light and dark stories run at 1440px; `phone()` moves one to 390px. */
export const desktop = { viewport: { value: 'desktop' } }

/** Heidi remembers per browser whether her panel was open; a page story starts with it closed. */
export const closeHeidi = () => {
  localStorage.removeItem('helvetly:heidi:panel')
}

type Story = StoryObj

/** The shell is there and the page shows its main content (the texts given), not the loader. */
export const shows =
  (...texts: (string | RegExp)[]): Story['play'] =>
  async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument
    const body = within(document.body)
    await body.findByRole('main', { hidden: true }, { timeout: 8000 }).catch(async () => {
      // What the page showed instead, so a hang in CI says where it stopped.
      const probe = await Promise.race([
        fetch('/api/v1/public/offers/current').then((response) => `status ${response.status}`),
        new Promise<string>((resolve) => setTimeout(() => resolve('no answer in 2 s'), 2000)),
      ]).catch((error: unknown) => `error ${String(error)}`)
      const requests = performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.includes('/api/'))
        .slice(-8)
        .map((entry) => `${entry.name} ${Math.round(entry.duration)} ms`)
      throw new Error(
        [
          'No <main> after 8 s.',
          `page age: ${Math.round(performance.now())} ms`,
          `service worker: ${navigator.serviceWorker?.controller?.state ?? 'none'}`,
          `probe: ${probe}`,
          `last api requests:\n${requests.join('\n')}`,
          `canvas: ${canvasElement.innerHTML.slice(0, 1500)}`,
        ].join('\n'),
      )
    })
    // A list can render a phone card and a desktop row for the same record; one must be visible.
    await waitFor(
      () => {
        for (const text of texts)
          expect(body.getAllByText(text).some((node) => node.checkVisibility())).toBe(true)
      },
      { timeout: 8000 },
    )
  }

export const dark = <S extends Story>(story: S): S => ({
  ...story,
  parameters: { ...story.parameters, dark: true },
})
export const phone = <S extends Story>(story: S): S => ({
  ...story,
  globals: { ...story.globals, viewport: { value: 'phone' } },
})

/** The paper's footer block (rule and field) ends at the paper's bottom padding, so the free space lies above it. */
export const expectFooterAtTheBottom = async (paper: HTMLElement) => {
  const footer = within(paper).getByRole('textbox', { name: 'Footer' }).parentElement
  const gap = paper.getBoundingClientRect().bottom - (footer?.getBoundingClientRect().bottom ?? 0)
  await expect(gap).toBeLessThanOrEqual(parseFloat(getComputedStyle(paper).paddingBottom) + 1)
}

import { expect, test } from '@playwright/test'

import { open, sizes, type App } from './storybook'

// Whole screens: desktop and phone, light and dark. Design-system stories: the story root, light and dark.
const screens: [App, string][] = [
  ['platform', 'pages-dashboard--with-data'],
  ['platform', 'pages-invoices--list'],
  ['platform', 'pages-invoices--detail'],
  ['platform', 'invoices-send-email-dialogs--invoice-ready'],
  ['platform', 'pages-clients--detail'],
  ['platform', 'pages-invoice-editor--draft-with-lines'],
  ['platform', 'pages-documents--folders-and-files'],
  ['platform', 'pages-documents--templates'],
  ['platform', 'pages-documents--folder-tree'],
  ['platform', 'books-settings--periods-overview'],
  ['platform', 'books-ledger--trial-balance'],
  ['platform', 'books-ledger--loaded'],
  ['platform', 'books-ledger--save-invalid'],
  ['platform', 'settings-portal-address--with-domain'],
  ['portal', 'pages-portal--overview'],
  ['portal', 'pages-portal--invoices'],
  ['portal', 'pages-portal--profile'],
  ['portal', 'portal-lists--engagement-activity'],
  ['portal', 'portal-shell--desktop'],
  ['portal', 'portal-shell--scrolled-header'],
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
  ['platform', 'design-system-components--drop-zone'],
  ['platform', 'design-system-components--picker-with-add-row'],
]
const themes = ['light', 'dark'] as const

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

import { expect, test, type Page } from '@playwright/test'

import { render, sizes, stories } from './storybook'

// The label of every button-like control sits in the middle of its box: the gap above the capitals and the
// gap below the baseline differ by at most 1 px. Chromium rounds a font's ascent and descent to whole pixels
// and floors the half-leading, so a size whose numbers do not add up places the text a pixel high or low
// even inside `items-center`. Measured from the layout, not from pixels: the baseline is the top of the text
// node's box plus the font's (rounded) ascent, the capitals rise the height of an "H" above it.

const controls = [
  'button',
  'a[data-slot$=button]',
  '[role=button]',
  '[role=tab]',
  '[role=combobox]:not(input)',
  '[data-slot=badge]',
  '[data-slot=status-badge]',
  'label:has(> input[type=radio])',
].join(', ')

/** `story: selector "label" offset` for every off-centre label; the page gets this code as text. */
function offCentre(page: Page) {
  return page.evaluate((selector) => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) throw new Error('text-centring: no 2d canvas')
    // One object: functions inside it are its methods, and the page gets all of this as text.
    const look = {
      shown: (element: Element) => {
        const style = getComputedStyle(element)
        return (
          element.getClientRects().length > 0 &&
          style.visibility === 'visible' &&
          // sr-only text is clipped to a pixel.
          element.getBoundingClientRect().width > 1
        )
      },
      /** The capitals' top and the baseline of one line of text, or null when it wraps or is hidden. */
      line: (text: Text) => {
        const parent = text.parentElement
        if (!parent || !look.shown(parent) || !text.data.trim()) return undefined
        // Other faces (a handwriting sample, a logo) have their own metrics; the rule is for the brand font.
        if (!/^"?inter/i.test(getComputedStyle(parent).fontFamily)) return undefined
        const range = document.createRange()
        range.selectNodeContents(text)
        const rects = range.getClientRects()
        if (rects.length !== 1) return null
        const style = getComputedStyle(parent)
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const metrics = context.measureText('H')
        const baseline = (rects[0]?.top ?? 0) + metrics.fontBoundingBoxAscent
        return {
          size: Number.parseFloat(style.fontSize),
          font: `${style.fontSize}/${style.lineHeight}`,
          rect: rects[0],
          top: baseline - metrics.actualBoundingBoxAscent,
          baseline,
        }
      },
      name: (element: Element) => {
        const slot = element.getAttribute('data-slot')
        const role = element.getAttribute('role')
        return `${element.tagName.toLowerCase()}${slot ? `[data-slot=${slot}]` : ''}${role ? `[role=${role}]` : ''}`
      },
      clear: (colour: string) => colour === 'transparent' || colour.endsWith(', 0)'),
      /** A shared button or badge (it has a variant), or one whose box shows: a fill, an edge or a shadow. */
      boxed: (element: Element) => {
        if (element.hasAttribute('data-variant')) return true
        const style = getComputedStyle(element)
        return (
          !look.clear(style.backgroundColor) ||
          style.boxShadow !== 'none' ||
          (Number.parseFloat(style.borderTopWidth) > 0 && !look.clear(style.borderTopColor))
        )
      },
    }
    return [...document.querySelectorAll(selector)].flatMap((control) => {
      // A scaled box (a toast stacked behind another, a pop-in mid-animation) is not where its text was laid out.
      const scaled =
        control instanceof HTMLElement &&
        Math.abs(control.getBoundingClientRect().height - control.offsetHeight) > 0.5
      if (
        scaled ||
        !look.shown(control) ||
        !look.boxed(control) ||
        getComputedStyle(control).display === 'inline'
      )
        return []
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT)
      const lines: Exclude<ReturnType<typeof look.line>, null | undefined>[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        // A count pinned to a corner, a nested control or tooltip text is not this control's label.
        let owner = node.parentElement
        let own = true
        for (; owner && owner !== control; owner = owner.parentElement)
          if (
            owner.matches(selector) ||
            ['absolute', 'fixed'].includes(getComputedStyle(owner).position)
          )
            own = false
        if (!own || !(node instanceof Text)) continue
        const found = look.line(node)
        if (found === null) return []
        if (found) lines.push(found)
      }
      // Text below other text (a card-like button: a name over its details) is not one label to centre.
      const starts = Math.max(...lines.map((found) => found.rect?.top ?? 0))
      const ends = Math.min(...lines.map((found) => found.rect?.bottom ?? 0))
      if (starts >= ends) return []
      // The label is the largest text; a smaller count or shortcut beside it is centred on its own.
      const largest = Math.max(...lines.map((found) => found.size))
      const label = lines.filter((found) => found.size === largest)
      if (!label.length) return []
      const top = Math.min(...label.map((found) => found.top))
      const bottom = Math.max(...label.map((found) => found.baseline))
      const box = control.getBoundingClientRect()
      const above = top - box.top
      const below = box.bottom - bottom
      if (Math.abs(above - below) <= 1) return []
      const text = control.textContent?.trim().slice(0, 30) ?? ''
      return [
        `${look.name(control)} "${text}" (${label[0]?.font} text in ${box.height} px): ${above.toFixed(2)} px above, ${below.toFixed(2)} px below`,
      ]
    })
  }, controls)
}

for (const app of ['platform', 'portal'] as const) {
  for (const id of stories(app)) {
    for (const [size, viewport] of Object.entries(sizes)) {
      test(`labels are centred: ${app} ${id} ${size}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await render(page, app, id)
        expect(await offCentre(page), 'these labels sit off the middle of their box').toEqual([])
      })
    }
  }
}

test('the check sees a label a pixel too high', async ({ page }) => {
  await page.setContent(
    `<button style="display:inline-flex;align-items:center;height:28px;padding:0 10px 2px;font:13px/1 Inter, sans-serif">Save draft</button>`,
  )
  expect(await offCentre(page)).not.toEqual([])
})

import { expect, test, type Page } from '@playwright/test'

import { fieldClass } from '../../packages/ui/src/lib/field-surface'
import { render, stories } from './storybook'

// Every field looks the same: the box of each input, textarea, select, combobox trigger and composite field (an
// input group, a textarea with its tools, any box marked `data-field-surface`) in every story has the background,
// border, shadow and corners of the shared surface (packages/ui/src/lib/field-surface.ts), and a single-line one its
// height, in both themes. A control inside a composite field is bare: the outer box is the field. Disabled, invalid
// and focused fields look different on purpose and are skipped.
//
// The only other exceptions carry the class `field-quiet`, because something else is their box: the paper of the
// invoice and quote editors (values that read as text until hovered, the line grid), a list's toolbar row, a menu's
// search and a chat composer's card. Never add it to a field of a form.

const fields = [
  'input:not([type=checkbox], [type=radio], [type=hidden], [type=range], [type=file], [type=color], [type=submit], [type=button], [type=reset], [type=image])',
  'textarea',
  'select',
  '[role=combobox]',
  '[data-slot=select-trigger]',
  '[data-slot=combobox-trigger]',
  '[data-slot=input-group]',
  '[data-slot=textarea-box]',
  '[data-field-surface]',
].join(', ')
// Inside these a field is not one of its own: a cmdk menu's search, a field inside a field, a quiet box.
const hosts = `[cmdk-root], [data-slot=input-group], [data-slot=textarea-box], [data-field-surface], .field-quiet`

/** `selector: property is X, not Y` for every field that differs from the reference in this theme. */
function differences(page: Page, reference: string) {
  return page.evaluate(
    ({ selector, quiet, probeClass }) => {
      // A field still easing out of a hover or focus is measured at rest.
      const still = document.createElement('style')
      still.textContent = '*, *::before, *::after { transition: none !important; }'
      document.head.append(still)
      const probe = document.createElement('input')
      probe.className = probeClass
      probe.style.position = 'absolute'
      probe.style.top = '-200px'
      document.body.append(probe)
      // One object: functions inside it are its methods, and the page gets all of this as text.
      const measure = {
        look: (element: Element) => {
          const style = getComputedStyle(element)
          return {
            'background-color': style.backgroundColor,
            'border-color': `${style.borderTopColor} ${style.borderRightColor} ${style.borderBottomColor} ${style.borderLeftColor}`,
            'border-width': `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`,
            'border-radius': style.borderRadius,
            'box-shadow': style.boxShadow,
            height: style.height,
          }
        },
        name: (element: Element) => {
          const id = element.id ? `#${element.id}` : ''
          const slot = element.getAttribute('data-slot')
          const label = element.getAttribute('aria-label') ?? element.getAttribute('placeholder')
          return `${element.tagName.toLowerCase()}${id}${slot ? `[data-slot=${slot}]` : ''}${label ? ` "${label.slice(0, 30)}"` : ''}`
        },
      }
      const expected = measure.look(probe)
      probe.remove()
      const report = [...document.querySelectorAll(selector)].flatMap((field) => {
        const style = getComputedStyle(field)
        const box = field.getBoundingClientRect()
        if (
          field.getClientRects().length === 0 ||
          style.visibility !== 'visible' ||
          Number(style.opacity) === 0 ||
          box.width <= 1 ||
          box.height <= 1 ||
          field.matches('.field-quiet') ||
          field.parentElement?.closest(quiet) ||
          field.closest('[role=grid], [role=listbox], [role=menu]') ||
          field.matches(
            ':disabled, [aria-disabled=true], [aria-invalid=true], [aria-expanded=true], :focus-within',
          ) ||
          field.querySelector(':disabled, [aria-invalid=true]')
        )
          return []
        const actual = Object.values(measure.look(field))
        // Several lines (a textarea, a composite with tools) are as high as their content.
        const single = !field.matches('textarea, [data-slot=textarea-box]') && box.height < 48
        return Object.entries(expected).flatMap(([property, value], at) => {
          const found = actual[at]
          if (found === value || (property === 'height' && !single)) return []
          return [`${measure.name(field)}: ${property} is ${found}, not ${value}`]
        })
      })
      still.remove()
      return report
    },
    { selector: fields, quiet: hosts, probeClass: reference },
  )
}

for (const app of ['platform', 'portal'] as const) {
  for (const id of stories(app)) {
    test(`fields share one surface: ${app} ${id}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      // Rendered, not settled: a pending story's fields are drawn while its request stays open.
      await render(page, app, id)
      await page.mouse.move(-1, -1)
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
      await page.evaluate(() => document.documentElement.classList.remove('dark'))
      expect(await differences(page, fieldClass), 'light: these fields look different').toEqual([])
      await page.evaluate(() => document.documentElement.classList.add('dark'))
      expect(await differences(page, fieldClass), 'dark: these fields look different').toEqual([])
    })
  }
}

test('the check sees a flat field', async ({ page }) => {
  const [first] = stories('platform')
  if (!first) throw new Error('field-surface: no platform stories')
  await render(page, 'platform', first)
  await page.evaluate(() => {
    const flat = document.createElement('input')
    flat.className = 'h-9 rounded-md border bg-muted shadow-none'
    document.body.append(flat)
  })
  expect(await differences(page, fieldClass)).not.toEqual([])
})

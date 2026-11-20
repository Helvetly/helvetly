import { expect, test, type Page } from '@playwright/test'

import { render, sizes, stories } from './storybook'

// Focusing a form control must never move or resize anything: not the control, its label or hint, nor the
// fields below it. Every story with a control is opened at desktop and phone width; each control is focused
// from the keyboard (`:focus-visible`) and each text field also by a real click, and every box in the page
// is compared with the one it had a moment before. Rings, outlines and other out-of-flow decoration (an
// absolute or fixed box: a tooltip, a resize grip) push nothing aside, so they do not count. On a phone every
// field is at least 16 px, or Safari zooms the page in as it gets focus (globals.css).

/** Installs `window.focusLayout` in the story: one object, as the page gets this code as text. */
function install(page: Page) {
  return page.evaluate(() => {
    const notTyped = new Set([
      'checkbox',
      'radio',
      'file',
      'range',
      'color',
      'button',
      'submit',
      'reset',
      'image',
    ])
    let before = new Map<Element, number[] | null>()
    const audit = {
      controls: () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            'input:not([type=hidden]), textarea, select, [role=combobox], [role=switch], [role=checkbox], [role=radio]',
          ),
        ].filter(
          (element) =>
            element.getClientRects().length > 0 &&
            !element.matches(':disabled, [aria-disabled=true]') &&
            getComputedStyle(element).visibility === 'visible',
        ),
      // Fields one types into; a click on any other control acts (toggles, opens) rather than only focusing.
      typed: () =>
        audit
          .controls()
          .filter(
            (control) =>
              control instanceof HTMLTextAreaElement ||
              (control instanceof HTMLInputElement && !notTyped.has(control.type)),
          ),
      frame: () => new Promise((done) => requestAnimationFrame(done)),
      quiet: () => new Promise((done) => setTimeout(done, 400)),
      boxes: () => {
        // A spinner turns forever and moves nothing else. Only an endless animation is skipped, and never
        // around the focused control: a finite transition on focus is exactly what this must catch.
        const moving = document.getAnimations().flatMap((animation) => {
          const effect = animation.effect
          const target = effect instanceof KeyframeEffect ? effect.target : null
          const endless = effect?.getComputedTiming().iterations === Infinity
          return target && endless && !target.contains(document.activeElement) ? [target] : []
        })
        return new Map(
          [...document.body.querySelectorAll('*')].map((element): [Element, number[] | null] => {
            if (moving.some((target) => target === element || target.contains(element)))
              return [element, null]
            const rect = element.getBoundingClientRect()
            return [element, [rect.left, rect.top, rect.width, rect.height]]
          }),
        )
      },
      /** What moved or appeared since `before`, apart from what an out-of-flow box carries. */
      changed: () => {
        const moved = new Set(
          [...audit.boxes()].flatMap(([element, box]) => {
            const old = before.get(element)
            if (!box || old === null) return []
            if (!old) return (box[2] ?? 0) > 0 || (box[3] ?? 0) > 0 ? [element] : []
            return box.some((value, i) => Math.abs(value - (old[i] ?? 0)) >= 0.5) ? [element] : []
          }),
        )
        return [...moved].filter((element) => {
          for (let box: Element | null = element; box; box = box.parentElement)
            if (['absolute', 'fixed'].includes(getComputedStyle(box).position))
              return !moved.has(box)
          return true
        })
      },
      name: (element: Element) => {
        const slot = element.getAttribute('data-slot')
        const text = element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30)
        return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${slot ? `[${slot}]` : ''} "${text ?? ''}"`
      },
      report: (how: string, control: Element, found: Element[]) => {
        const lines = found.slice(0, 6).map((element) => {
          const old = before.get(element)?.map((value) => value.toFixed(1))
          const rect = element.getBoundingClientRect()
          const now = [rect.left, rect.top, rect.width, rect.height].map((value) =>
            value.toFixed(1),
          )
          return `${audit.name(element)} ${old ? `${old} -> ${now}` : `appeared at ${now}`}`
        })
        return `${how} ${audit.name(control)}:\n  ${lines.join('\n  ')}`
      },
      /** In view (focusing must not need a scroll) and still (no transition or late data running). */
      settle: async (control: HTMLElement) => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        control.scrollIntoView({ block: 'center', inline: 'nearest' })
        await audit.still(30)
      },
      /** Up to `tries` two-frame looks, until one finds nothing moving. */
      still: async (tries: number): Promise<void> => {
        before = audit.boxes()
        await audit.frame()
        await audit.frame()
        if (audit.changed().length > 0 && tries > 1) await audit.still(tries - 1)
      },
      keyboardFocus: async (control: HTMLElement) => {
        await audit.settle(control)
        control.focus({ preventScroll: true })
        await audit.frame()
        await audit.frame()
        return audit.changed()
      },

      /** Focuses each control from script after a key press, which Chromium shows as keyboard focus. */
      keyboard: () => audit.keyboardEach(audit.controls()),
      /** One control after the other: focusing two at once is not a thing. */
      keyboardEach: async ([control, ...rest]: HTMLElement[]): Promise<string[]> => {
        if (!control) return []
        const found = await audit.tabTo(control)
        return [...found, ...(await audit.keyboardEach(rest))]
      },
      tabTo: async (control: HTMLElement) => {
        // A shift counts only when it happens again: late data or a lazy image can land mid-check.
        if (!(await audit.keyboardFocus(control)).length) return []
        await audit.quiet()
        const shifted = await audit.keyboardFocus(control)
        return shifted.length ? [audit.report('Tab to', control, shifted)] : []
      },
      textFields: () => audit.typed().length,
      /** Readies text field `index` for a click: where to click, or null when something covers it. */
      prepareClick: async (index: number) => {
        const control = audit.typed()[index]
        if (!control) return null
        await audit.settle(control)
        const rect = control.getBoundingClientRect()
        const [x, y] = [rect.left + Math.min(rect.width / 2, 24), rect.top + rect.height / 2]
        const hit = document.elementFromPoint(x, y)
        Reflect.set(window, 'focusLayoutClicked', control)
        return hit && (hit === control || control.contains(hit) || hit.contains(control))
          ? [x, y]
          : null
      },
      afterClick: async () => {
        await audit.frame()
        await audit.frame()
        const control: unknown = Reflect.get(window, 'focusLayoutClicked')
        const shifted = audit.changed()
        return shifted.length && control instanceof Element
          ? [audit.report('Click on', control, shifted)]
          : []
      },
      /** Fields below 16 px, which Safari on a phone zooms the whole page in on as they get focus. */
      zooming: () =>
        [
          ...audit.typed(),
          ...audit.controls().filter((control) => control instanceof HTMLSelectElement),
          ...document.querySelectorAll('[contenteditable]:not([contenteditable=false])'),
        ]
          .filter((field) => Number.parseFloat(getComputedStyle(field).fontSize) < 16)
          .map((field) => `${audit.name(field)} is ${getComputedStyle(field).fontSize}`),
    }
    Reflect.set(window, 'focusLayout', audit)
  })
}

async function call(page: Page, method: string, index = 0): Promise<unknown> {
  return page.evaluate(
    async ([key, at]) => {
      const audit: unknown = Reflect.get(window, 'focusLayout')
      const fn: unknown = typeof audit === 'object' && audit ? Reflect.get(audit, key) : undefined
      return typeof fn === 'function' ? await Reflect.apply(fn, audit, [at]) : undefined
    },
    [method, index] as const,
  )
}

const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : [])

for (const app of ['platform', 'portal'] as const) {
  for (const id of stories(app)) {
    for (const [size, viewport] of Object.entries(sizes)) {
      test(`focus keeps the layout: ${app} ${id} ${size}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await render(page, app, id)
        await install(page)
        const found = size === 'phone' ? strings(await call(page, 'zooming')) : []
        // A key press first: from then on, focus from script is keyboard focus (:focus-visible).
        await page.keyboard.press('Shift')
        found.push(...strings(await call(page, 'keyboard')))
        const click = async (index: number) => {
          const point = await call(page, 'prepareClick', index)
          if (!Array.isArray(point)) return []
          await page.mouse.click(Number(point[0]), Number(point[1]))
          return strings(await call(page, 'afterClick'))
        }
        const fields = Number(await call(page, 'textFields'))
        // One field after the other, as each click moves focus away from the one before.
        const clickFrom = async (index: number): Promise<string[]> => {
          if (index >= fields) return []
          const recheck = async () => {
            await page.waitForTimeout(400)
            return click(index)
          }
          const shifted = (await click(index)).length ? await recheck() : []
          return [...shifted, ...(await clickFrom(index + 1))]
        }
        found.push(...(await clickFrom(0)))
        expect(found, 'focusing a control moved or resized these elements').toEqual([])
      })
    }
  }
}

test('the guard sees a finite transition that moves a field on focus', async ({ page }) => {
  await page.setContent(
    `<style>input{display:block;transition:transform 150ms linear}input:focus{transform:translateY(12px)}</style><input aria-label="Email">`,
  )
  await install(page)
  await page.keyboard.press('Shift')
  expect(strings(await call(page, 'keyboard'))).not.toEqual([])
})

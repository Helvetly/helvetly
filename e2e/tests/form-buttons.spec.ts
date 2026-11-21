import type { Locator, Page } from '@playwright/test'

import { expect, test, text } from './fixtures'

// "+ Add line" once submitted the quote editor's form: it saved and closed the drawer. Only Save may save.

/** Whatever a click opened on top of the editor: a menu, a picker, a confirmation. */
const opened = (page: Page) =>
  page.locator(
    '[role="menu"], [role="listbox"], [role="alertdialog"], [data-slot="popover-content"]',
  )

/**
 * Closes what a click opened and waits until it has left the page, exit animation and all: while it is still leaving,
 * the next click's check would count it and send an Escape that reaches the editor ("Discard your changes?").
 */
async function closeOpened(page: Page) {
  if ((await opened(page).count()) > 0) await page.keyboard.press('Escape')
  await expect(opened(page)).toHaveCount(0)
}

/**
 * Clicks every visible, enabled button of `editor` but its submit and the `skip`ped ways out, closing what each
 * opens with Escape; the editor stays open throughout.
 */
async function clickEveryButton(page: Page, editor: Locator, skip: RegExp) {
  const buttons = editor.locator('button:not([type="submit"])')
  const count = await buttons.count()
  // One after another: browser steps must not overlap.
  const clickFrom = async (index: number): Promise<void> => {
    if (index >= count) return
    const button = buttons.nth(index)
    if ((await button.isVisible()) && (await button.isEnabled())) {
      const name = ((await button.getAttribute('aria-label')) ?? (await button.innerText())).trim()
      if (!skip.test(name)) {
        await button.click()
        await closeOpened(page)
        await expect(editor, `after clicking "${name}"`).toBeVisible()
      }
    }
    await clickFrom(index + 1)
  }
  await clickFrom(0)
}

/** The named controls of the lines editor, each closed again before the next. */
async function clickLineControls(page: Page, editor: Locator) {
  await editor.getByRole('button', { name: /^Add line/ }).click()
  await expect(editor.getByRole('textbox', { name: 'Line 2 description' })).toBeVisible()
  await editor.getByRole('button', { name: /^Add from catalogue/ }).click()
  await closeOpened(page)
  await editor.getByRole('button', { name: 'Actions for line 1' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await closeOpened(page)
  await expect(editor).toBeVisible()
}

test('a draft quote saves only on Save: no other control in the editor submits it', async ({
  api,
  page,
}) => {
  await api.settings()
  const client = await api.client()
  const quote = await api.save('/quotes', {
    client_id: client.id,
    lines: [
      {
        description: 'Website relaunch',
        quantity: '1',
        unit_price: '900',
        vat_category: 'S',
        vat_rate: '8.1',
      },
    ],
  })
  const path = `/quotes/${text(quote.id)}`

  await page.goto(`/quotes?id=${text(quote.id)}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const editor = page.getByRole('form', { name: 'Edit draft quote' })
  await clickLineControls(page, editor)
  await clickEveryButton(page, editor, /^(Close editor|Cancel)$/)

  await expect(editor).toBeVisible()
  expect(await api.read(path)).toMatchObject({ updated_at: quote.updated_at, lines: quote.lines })

  // Save still saves.
  await page.reload()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await editor.getByRole('textbox', { name: /Reference/ }).fill('PO 4711')
  await editor.getByRole('button', { name: 'Save changes' }).click()
  await expect(editor).toBeHidden()
  await expect.poll(async () => (await api.read(path)).reference).toBe('PO 4711')
})

test('a draft invoice editor stays open whatever control is clicked', async ({ api, page }) => {
  const draft = await api.draft(await api.client())
  const path = `/invoices/${text(draft.id)}`

  await page.goto(`/invoices?compose=${text(draft.id)}`)
  const editor = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('button', { name: /^Add line/ }) })
  await clickLineControls(page, editor)
  // The instalments switch opens its own settings; closing them changes nothing.
  await editor.getByRole('switch', { name: 'Pay in instalments' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Pay in instalments' })).toBeHidden()
  await clickEveryButton(
    page,
    editor,
    /^(Close|Close editor|Cancel|Preview|Delete.*|Issue.*|Send.*)$/i,
  )

  await expect(editor).toBeVisible()
  await expect(page).toHaveURL(/compose=/)
  expect((await api.read(path)).status).toBe('draft')
})

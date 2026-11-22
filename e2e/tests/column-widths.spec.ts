import type { Locator, Page } from '@playwright/test'

import { expect, test } from './fixtures'

const widthOf = (head: Locator) => async () =>
  Math.round(await head.evaluate((element) => element.getBoundingClientRect().width))

async function drag(page: Page, column: string, by: number) {
  const box = await page.getByRole('button', { name: `Resize ${column}` }).boundingBox()
  if (!box) throw new Error('The resize handle has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + by / 2, y, { steps: 4 })
  await page.mouse.move(x + by, y, { steps: 4 })
  await page.mouse.up()
}

test('a dragged column width on the invoices list survives a reload', async ({ api, page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await api.settings()
  await api.draft(await api.client())

  await page.goto('/invoices')
  const amount = page.getByRole('columnheader', { name: /^Amount/ })
  const client = page.getByRole('columnheader', { name: /^Client/ })
  await expect(amount).toBeVisible()
  const amountBefore = await widthOf(amount)()
  const clientBefore = await widthOf(client)()

  await drag(page, 'Amount', -60)
  await expect.poll(widthOf(amount)).toBe(amountBefore - 60)
  // Only the dragged column changes: the table gets narrower, the client column stays.
  await expect.poll(widthOf(client)).toBe(clientBefore)

  await page.reload()
  await expect(amount).toBeVisible()
  await expect.poll(widthOf(amount)).toBe(amountBefore - 60)
})

test('the clients name column resizes like any other, and one click opens the client', async ({
  api,
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const client = await api.client()
  await page.goto('/clients')
  const name = page.getByRole('columnheader', { name: /^Name/ })
  const city = page.getByRole('columnheader', { name: /^City/ })
  await expect(name).toBeVisible()
  const nameBefore = await widthOf(name)()
  const cityBefore = await widthOf(city)()

  await drag(page, 'City', -40)
  await expect.poll(widthOf(city)).toBe(cityBefore - 40)
  await expect.poll(widthOf(name)).toBe(nameBefore)
  await drag(page, 'Name', 80)
  await expect.poll(widthOf(name)).toBe(nameBefore + 80)
  await expect.poll(widthOf(city)).toBe(cityBefore - 40)
  // 40 px wider than the box now: it scrolls sideways.
  const scroller = name.locator('xpath=ancestor::table/..')
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBe(40)

  await page.getByRole('button', { name: new RegExp(`^${String(client.name)}`) }).click()
  await expect(page.getByRole('dialog', { name: new RegExp(String(client.name)) })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`[?&]id=${String(client.id)}`))
})

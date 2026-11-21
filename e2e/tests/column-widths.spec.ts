import { expect, test } from './fixtures'

test('a dragged column width on the invoices list survives a reload', async ({ api, page }) => {
  await api.settings()
  await api.draft(await api.client())

  await page.goto('/invoices')
  const client = page.getByRole('columnheader', { name: /^Client/ })
  await expect(client).toBeVisible()
  const before = await client.evaluate((head) => head.getBoundingClientRect().width)

  const handle = page.getByRole('slider', { name: 'Resize Client' })
  const box = await handle.boundingBox()
  if (!box) throw new Error('The resize handle has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 60, y, { steps: 4 })
  await page.mouse.move(x + 150, y, { steps: 4 })
  await page.mouse.up()

  const width = async () =>
    Math.round(await client.evaluate((head) => head.getBoundingClientRect().width))
  await expect.poll(width).toBe(Math.round(before + 150))

  await page.reload()
  await expect(client).toBeVisible()
  await expect.poll(width).toBe(Math.round(before + 150))
})

test('the clients name column narrows, keeps the row full, and one click opens the client', async ({
  api,
  page,
}) => {
  const client = await api.client()
  await page.goto('/clients')
  const name = page.getByRole('columnheader', { name: /^Name/ })
  await expect(name).toBeVisible()
  const width = async () =>
    Math.round(await name.evaluate((head) => head.getBoundingClientRect().width))
  const before = await width()

  const box = await page.getByRole('slider', { name: 'Resize Name' }).boundingBox()
  if (!box) throw new Error('The resize handle has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 40, y, { steps: 4 })
  await page.mouse.up()
  await expect.poll(width).toBe(before - 40)
  const scroller = name.locator('xpath=ancestor::table/..')
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBe(0)

  await page.getByRole('button', { name: new RegExp(`^${String(client.name)}`) }).click()
  await expect(page.getByRole('dialog', { name: new RegExp(String(client.name)) })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`[?&]id=${String(client.id)}`))
})

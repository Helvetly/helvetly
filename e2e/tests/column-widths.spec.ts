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

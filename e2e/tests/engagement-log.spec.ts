import { expect, object, openPage, test, text, today, uniqueName } from './fixtures'

const dayBefore = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - 1)
  return day.toISOString().slice(0, 10)
}

test('the detail logs a delivery and points at the date when it falls before the start', async ({
  page,
  api,
}) => {
  const client = await api.client()
  const engagement = await api.save('/engagements', {
    client_id: text(client.id),
    title: uniqueName('E2E Log'),
    quantity: '10',
    unit: 'hour',
    billing: 'arrears',
    unit_price: '100',
    price_basis: 'net',
    currency: 'CHF',
    vat_category: 'S',
    vat_rate: '8.1',
    start_date: today(),
    recurrence: 'monthly',
  })
  const entries = `/engagements/${text(engagement.id)}/entries`
  // The API names the day to pick, for any client that skips the form's own check.
  const refused = await api.write(entries, { date: dayBefore(today()), quantity: '1' })
  expect(refused.status()).toBe(422)
  const fields = object(object(object(await refused.json()).error).details).fields
  expect(text(object(fields).date)).toMatch(/^Pick a date from .+ \(the engagement's start\)\.$/)

  await openPage(page, `/engagements?id=${text(engagement.id)}`, 'Engagement detail')
  const form = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Log delivery' }),
  })
  const date = form.getByLabel('Date')
  await date.fill(dayBefore(today()))
  await form.getByRole('textbox', { name: 'Quantity' }).fill('1')
  await form.getByRole('button', { name: /^Log 1/ }).click()
  await expect(form.getByText(/Pick a date from .+ \(the engagement's start\)\./)).toBeVisible()
  await expect(date).toHaveAttribute('aria-invalid', 'true')

  await date.fill(today())
  await expect(date).not.toHaveAttribute('aria-invalid')
  await form.getByRole('button', { name: /^Log 1/ }).click()
  await expect(page.getByText(/Logged 1/)).toBeVisible()
  const list = await api.request.get(`/api/v1${entries}`)
  const saved = object(await list.json()).data
  if (!Array.isArray(saved)) throw new Error('Expected the entries')
  expect(saved.map((entry) => object(entry).date)).toEqual([today()])
})

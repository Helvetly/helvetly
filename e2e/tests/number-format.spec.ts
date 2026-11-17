import { expect, object, test, text, today } from './fixtures'

test('a custom number format is refused without the year, saved from the browser and numbers issued invoices', async ({
  page,
  api,
}) => {
  await api.settings()
  await page.goto('/settings/invoices')
  const numbering = page.getByRole('region', { name: 'Numbering' })
  await numbering.getByRole('button', { name: /Number format/ }).click()
  await page.getByRole('option', { name: /Custom format/ }).click()
  const field = numbering.getByRole('textbox', { name: 'Custom format' })

  await field.fill('E2E/{NN}')
  await numbering.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    numbering.getByText('Put the year in: the running number starts again each year.'),
  ).toBeVisible()
  // the API refuses it too, whatever the browser lets through
  const refused = await api.write('/invoice-settings', { number_format: 'E2E/{NN}' }, 'PUT')
  expect(refused.status()).toBe(422)

  await field.fill('E2E/{TYPE}/{MM}/{YYYY}/{NN}')
  const [year, month] = today().split('-')
  await expect(numbering.getByRole('status', { name: 'Next numbers' })).toContainText(
    `E2E/INV/${month}/${year}/01`,
  )
  await numbering.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(numbering.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload()
  await expect(field).toHaveValue('E2E/{TYPE}/{MM}/{YYYY}/{NN}')

  const client = await api.client()
  const first = await api.save(`/invoices/${text((await api.draft(client)).id)}/issue`)
  const second = await api.save(`/invoices/${text((await api.draft(client)).id)}/issue`)
  expect([first.number, second.number]).toEqual([
    `E2E/INV/${month}/${year}/01`,
    `E2E/INV/${month}/${year}/02`,
  ])
  const listed = await api.request.get(`/api/v1/invoices/${text(second.id)}`)
  expect(object(object(await listed.json()).data).number).toBe(`E2E/INV/${month}/${year}/02`)
})

import { expect, openPage, test, text } from './fixtures'

test('dashboard audit compares originals and links the missing agreement to the issued invoice', async ({
  page,
  api,
}) => {
  await api.approveAI()
  await api.settings()
  const draft = await api.draft(await api.client(), { contract_reference: 'AUD-2026-01' })
  const issued = await api.save(`/invoices/${text(draft.id)}/issue`)
  await openPage(page, '/', 'Dashboard')
  await page.getByRole('button', { name: 'AI Audit' }).click()
  const modal = page.getByRole('dialog', { name: 'AI Audit' })
  await expect(modal.getByText(/AI automation allowance/)).toBeVisible()
  await modal.getByRole('button', { name: 'Start audit' }).click()
  const drawer = page.getByRole('dialog', { name: 'AI Audit' })
  await expect(drawer.getByText('Scope: Full audit')).toBeVisible()
  await drawer.getByText('Contract reference without a file link').click()
  await expect(drawer.getByRole('link', { name: text(issued.number) })).toHaveAttribute(
    'href',
    `/invoices?id=${text(issued.id)}`,
  )
  await expect(drawer.getByText('1 of 1 originals read · 0 with limited coverage')).toBeVisible()
})

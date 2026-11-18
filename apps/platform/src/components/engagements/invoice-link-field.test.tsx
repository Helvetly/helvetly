import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { InvoiceLinkField } from './invoice-link-field'

afterEach(() => vi.unstubAllGlobals())

const invoice = {
  id: 'inv_1',
  number: '2026-001',
  issue_date: '2026-11-02',
  currency: 'CHF',
  total: '120.00',
}

function stubInvoices(data: unknown[]) {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input) => {
      urls.push(String(input))
      return Response.json({
        data,
        meta: { page: 1, page_size: 100, total: data.length, total_pages: 1 },
      })
    }),
  )
  return urls
}

function renderField(clientId: string, onChange = vi.fn<(id: string) => void>()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InvoiceLinkField id="f" clientId={clientId} value="" onChange={onChange} />
    </QueryClientProvider>,
  )
  return onChange
}

test('no client: disabled with a hint, and nothing is fetched', () => {
  const urls = stubInvoices([])
  renderField('')
  expect(screen.getByRole('button', { name: /Choose a client first/ })).toBeDisabled()
  expect(urls).toEqual([])
})

test('no candidates: disabled with a muted hint', async () => {
  stubInvoices([])
  renderField('cli_1')
  expect(
    await screen.findByRole('button', { name: /No invoices without an engagement/ }),
  ).toBeDisabled()
})

test('asks only for the client’s unlinked invoices and picks one', async () => {
  const urls = stubInvoices([invoice])
  const onChange = renderField('cli_1')
  await userEvent.click(await screen.findByRole('button', { name: /Choose an invoice/ }))
  await userEvent.click(await screen.findByText('2026-001'))
  expect(onChange).toHaveBeenCalledWith('inv_1')
  expect(urls[0]).toContain('client_id=cli_1')
  expect(urls[0]).toContain('unlinked=1')
})

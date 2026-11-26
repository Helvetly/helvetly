import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { setupServer } from 'msw/node'
import { createElement, type ReactNode } from 'react'

import { handlers } from '@/mocks/handlers'

import {
  emailLanguage,
  fillEmailText,
  useEmailTextDraft,
  useEmailTexts,
  useInvoiceEmailDraft,
  useQuoteEmailDraft,
} from './email-texts'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}

test('fills a kind in a language from the built-in texts; unknown names stay as written', async () => {
  const { wrapper } = setup()
  const list = renderHook(() => useEmailTexts(), { wrapper })
  await waitFor(() => expect(list.result.current.data).toBeDefined())
  expect(fillEmailText(undefined, 'document', 'en', {})).toBeNull()
  const filled = fillEmailText(list.result.current.data, 'signature_request', 'en', {
    document: 'Lease',
    sender: 'Ana Muster',
  })
  expect(filled?.subject).toBe('{company} asks you to sign “Lease”')
  expect(filled?.body).toContain('Please review and sign “Lease”')
  expect(filled?.body).toMatch(/\{company\}$/)
  expect(emailLanguage('fr')).toBe('fr')
  expect(emailLanguage('pl', 'de')).toBe('de')
  expect(emailLanguage(null)).toBe('en')
})

test('a draft follows its values until the person types, then keeps what they wrote', async () => {
  const { wrapper } = setup()
  const values = { document: 'Lease', sender: 'Ana', company: 'Muster GmbH', client: 'Acme AG' }
  const hook = renderHook(
    ({ document }) => useEmailTextDraft('document', 'en', { ...values, document }),
    { wrapper, initialProps: { document: 'Lease' } },
  )
  await waitFor(() => expect(hook.result.current.subject).toBe('Lease from Muster GmbH'))
  expect(hook.result.current.touched).toBe(false)
  hook.rerender({ document: 'Lease 2026' })
  expect(hook.result.current.message).toContain('“Lease 2026”')
  act(() => hook.result.current.setMessage('My own words'))
  hook.rerender({ document: 'Lease 2027' })
  expect(hook.result.current.message).toBe('My own words')
  expect(hook.result.current.subject).toBe('Lease 2027 from Muster GmbH')
  expect(hook.result.current.touched).toBe(true)
})

test('invoice and quote drafts come from their documents', async () => {
  const { wrapper } = setup()
  const invoice = renderHook(() => useInvoiceEmailDraft('inv_1'), { wrapper })
  await waitFor(() => expect(invoice.result.current.data).toBeDefined())
  expect(invoice.result.current.data?.subject).toBe('Invoice 2026-001 from Muster GmbH')
  expect(invoice.result.current.data?.to).toEqual(['billing@acme.ch'])
  const quote = renderHook(() => useQuoteEmailDraft('missing'), { wrapper })
  await waitFor(() => expect(quote.result.current.isError).toBe(true))
})

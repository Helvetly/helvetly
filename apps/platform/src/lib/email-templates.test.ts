import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { setupServer } from 'msw/node'
import { createElement, type ReactNode } from 'react'

import { resetEmailTemplatesMock } from '@/mocks/email-templates'
import { handlers } from '@/mocks/handlers'

import { ApiError } from './api'
import {
  emailLanguage,
  emailTemplateKeys,
  fillEmailTemplate,
  useTemplateDraft,
  useEmailTemplates,
  useInvoiceEmailDraft,
  useQuoteEmailDraft,
  useResetEmailTemplate,
  useSaveEmailTemplate,
} from './email-templates'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(resetEmailTemplatesMock)

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}

test('lists 28 templates and builds the invoice draft from the default', async () => {
  const { wrapper } = setup()
  const list = renderHook(() => useEmailTemplates(), { wrapper })
  const draft = renderHook(() => useInvoiceEmailDraft('inv_1'), { wrapper })
  await waitFor(() => expect(list.result.current.data).toHaveLength(28))
  expect(list.result.current.data?.[0]).toMatchObject({ kind: 'invoice', language: 'de' })
  await waitFor(() => expect(draft.result.current.data).toBeDefined())
  expect(draft.result.current.data).toEqual({
    to: ['billing@acme.ch'],
    subject: 'Invoice 2026-001 from Muster GmbH',
    message:
      "Hello\n\nPlease find attached our invoice 2026-001 for CHF 1'234.50, payable by 31.12.2026.\n\nKind regards\nMuster GmbH",
    reply_to: 'billing@muster.ch',
  })
})

test('save marks custom and refetches both drafts, reset restores the default', async () => {
  const { wrapper } = setup()
  const list = renderHook(() => useEmailTemplates(), { wrapper })
  const invoice = renderHook(() => useInvoiceEmailDraft('inv_1'), { wrapper })
  const quote = renderHook(() => useQuoteEmailDraft('quo_sent'), { wrapper })
  const save = renderHook(() => useSaveEmailTemplate(), { wrapper })
  const reset = renderHook(() => useResetEmailTemplate(), { wrapper })
  await waitFor(() => expect(quote.result.current.data).toBeDefined())
  await waitFor(() => expect(invoice.result.current.data).toBeDefined())

  await act(() =>
    save.result.current.mutateAsync({
      kind: 'invoice',
      language: 'en',
      subject: 'Bill {number}',
      body: 'Hi {client}',
    }),
  )
  await waitFor(() => expect(invoice.result.current.data?.subject).toBe('Bill 2026-001'))
  expect(invoice.result.current.data?.message).toBe('Hi Acme AG')
  expect(
    list.result.current.data?.find((t) => t.kind === 'invoice' && t.language === 'en'),
  ).toMatchObject({ custom: true })

  await act(() => reset.result.current.mutateAsync({ kind: 'invoice', language: 'en' }))
  await waitFor(() =>
    expect(invoice.result.current.data?.subject).toBe('Invoice 2026-001 from Muster GmbH'),
  )
  const item = list.result.current.data?.find((t) => t.kind === 'invoice' && t.language === 'en')
  expect(item).toMatchObject({ custom: false, subject: item?.default.subject })
})

test('an empty subject is a 400 with the field named', async () => {
  const { wrapper, client } = setup()
  const save = renderHook(() => useSaveEmailTemplate(), { wrapper })
  const error = await act(() =>
    save.result.current
      .mutateAsync({ kind: 'quote', language: 'fr', subject: '', body: 'x' })
      .catch((caught: unknown) => caught),
  )
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ status: 400, details: { fields: { subject: expect.any(String) } } })
  expect(client.getQueryState(emailTemplateKeys.all)).toBeUndefined()
})

test('fills a kind in a language from the workspace texts; unknown names stay as written', async () => {
  const { wrapper } = setup()
  const list = renderHook(() => useEmailTemplates(), { wrapper })
  await waitFor(() => expect(list.result.current.data).toBeDefined())
  expect(fillEmailTemplate(undefined, 'document', 'en', {})).toBeNull()
  const filled = fillEmailTemplate(list.result.current.data, 'signature_request', 'en', {
    document: 'Lease',
    sender: 'Ana Muster',
  })
  expect(filled?.subject).toBe('Ana Muster sent you “Lease” to sign')
  expect(filled?.body).toContain('Please review and sign “Lease”')
  expect(filled?.body).toMatch(/\{company\}$/)
  expect(emailLanguage('fr')).toBe('fr')
  expect(emailLanguage('pl', 'de')).toBe('de')
  expect(emailLanguage(null)).toBe('en')
})

test('a template draft follows its values until the person types, then keeps what they wrote', async () => {
  const { wrapper } = setup()
  const values = { document: 'Lease', sender: 'Ana', company: 'Muster GmbH', client: 'Acme AG' }
  const hook = renderHook(
    ({ document }) => useTemplateDraft('document', 'en', { ...values, document }),
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

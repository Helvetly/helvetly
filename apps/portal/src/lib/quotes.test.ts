import { ApiError, setCsrfToken } from '@helvetly/ui/lib/http'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { portalHandlers, portalQuotes, portalSession } from '@/mocks/portal'

import {
  decidePortalQuote,
  isAwaiting,
  listPortalQuotes,
  portalQuotePdfUrl,
  quoteName,
  type PortalQuote,
} from './quotes'

const server = setupServer(...portalHandlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const sent = portalQuotes[0] as PortalQuote
const quote = (fields: Partial<PortalQuote>): PortalQuote => ({ ...sent, ...fields })

describe('portal quotes client', () => {
  it('lists quotes', async () => {
    expect(await listPortalQuotes()).toEqual(portalQuotes)
  })

  it('builds the pdf url', () => {
    expect(portalQuotePdfUrl('q 1')).toBe('/api/v1/public/portal/quotes/q%201/pdf')
  })

  it('accepts with the csrf token and a trimmed note', async () => {
    setCsrfToken(portalSession.csrf_token)
    const answered = await decidePortalQuote(sent.id, 'accept', '  Go ahead.  ')
    expect(answered).toMatchObject({ id: sent.id, status: 'accepted', decision_note: 'Go ahead.' })
  })

  it('sends no note when it is blank', async () => {
    setCsrfToken(portalSession.csrf_token)
    let body: unknown
    server.use(
      http.post('/api/v1/public/portal/quotes/:id/decline', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ data: { ...sent, status: 'declined' } })
      }),
    )
    expect((await decidePortalQuote(sent.id, 'decline', '   ')).status).toBe('declined')
    expect(body).toEqual({})
  })

  it('throws the API message on 409', async () => {
    setCsrfToken(portalSession.csrf_token)
    const error = await decidePortalQuote('quo_4', 'accept', '').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'invalid_state' })
  })
})

describe('quote helpers', () => {
  it('isAwaiting only for sent quotes', () => {
    expect(isAwaiting(quote({ status: 'sent' }))).toBe(true)
    for (const status of ['accepted', 'declined', 'expired'] as const)
      expect(isAwaiting(quote({ status }))).toBe(false)
  })

  it('quoteName adds the revision from the second on', () => {
    expect(quoteName(quote({ number: 'Q-1', revision: 1 }))).toBe('Q-1')
    expect(quoteName(quote({ number: 'Q-1', revision: 3 }))).toBe('Q-1 · Rev. 3')
  })
})

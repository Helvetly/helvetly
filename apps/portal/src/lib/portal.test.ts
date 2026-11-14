import { ApiError } from '@helvetly/ui/lib/http'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { portalHandlers, portalInvoices, portalSession, unauthenticated } from '@/mocks/portal'

import {
  deletePortalAvatar,
  getPortalSession,
  listPortalInvoices,
  portalDocumentUrl,
  portalInvoicePdfUrl,
  requestProfileChange,
  sessionFrom,
  verifyPortalCode,
} from './portal'

const server = setupServer(...portalHandlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('portal client', () => {
  it('returns null on 401', async () => {
    server.use(http.get('/api/v1/public/portal/session', unauthenticated))
    expect(await getPortalSession()).toBeNull()
  })

  it('lists invoices', async () => {
    expect(await listPortalInvoices()).toEqual(portalInvoices)
  })

  it('builds download urls', () => {
    expect(portalInvoicePdfUrl('inv_1')).toBe('/api/v1/public/portal/invoices/inv_1/pdf')
    expect(portalDocumentUrl('d 1')).toBe('/api/v1/public/portal/documents/d%201/download')
  })

  it('sends the session csrf token with a change request', async () => {
    await getPortalSession()
    expect(await requestProfileChange({ city: 'Zürich' })).toMatchObject({
      id: 'ccr_1',
      fields: { city: 'Zürich' },
    })
  })

  // The upload's multipart body is covered by the Photo stories in a real browser: jsdom's FormData
  // does not reach Node's fetch.
  it('removes the photo with the session csrf token', async () => {
    await getPortalSession()
    await expect(deletePortalAvatar()).resolves.toBeNull()
  })

  it('reads a session without avatar_url as having no photo', () => {
    const { avatar_url: _none, ...older } = portalSession
    expect(sessionFrom(older).avatar_url).toBe('')
  })

  it('takes the csrf token from verify', async () => {
    expect(await verifyPortalCode('a@b.ch', '123456')).toEqual({ csrf_token: 'portal-csrf' })
  })

  it('surfaces 422 field details', async () => {
    await getPortalSession()
    const error = await requestProfileChange({ zip: 'bad' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error instanceof ApiError && error.details).toEqual({ fields: { zip: 'invalid' } })
  })

  it('does not run the staff 401 handler', async () => {
    server.use(
      http.get('/api/v1/public/portal/invoices', () => HttpResponse.json({}, { status: 500 })),
    )
    await expect(listPortalInvoices()).rejects.toBeInstanceOf(ApiError)
  })

  it('reads a session from an older API without email or clients', async () => {
    const { email: _, clients: __, ...older } = portalSession
    server.use(http.get('/api/v1/public/portal/session', () => HttpResponse.json(older)))
    expect(await getPortalSession()).toEqual({
      ...older,
      email: '',
      clients: [
        { id: older.client.id, name: older.client.name, workspace_name: older.workspace.name },
      ],
    })
  })
})

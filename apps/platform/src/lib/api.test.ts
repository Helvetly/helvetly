import { api, ApiError, getCsrfToken, request, setCsrfToken, setUnauthorizedHandler } from './api'

const error = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status })

const csrfHeader = (init: RequestInit | undefined) => new Headers(init?.headers).get('X-CSRF-Token')

afterEach(() => {
  vi.unstubAllGlobals()
  setCsrfToken('')
  setUnauthorizedHandler(() => {})
})

test('does not replay a write into a session changed in another tab', async () => {
  setCsrfToken('stale')
  const unauthorized = vi.fn<() => void>()
  setUnauthorizedHandler(unauthorized)
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(error(403, 'csrf_failed'))
    .mockResolvedValueOnce(Response.json({ csrf_token: 'fresh' }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)

  await expect(
    request('/clients', { method: 'POST', json: { name: 'Client from old workspace' } }),
  ).rejects.toMatchObject({
    status: 403,
    code: 'csrf_failed',
  })

  expect(fetch.mock.calls.map((call) => call[0])).toEqual(['/api/v1/clients'])
  expect(csrfHeader(fetch.mock.calls[0]?.[1])).toBe('stale')
  expect(getCsrfToken()).toBe('')
  expect(unauthorized).toHaveBeenCalledOnce()
})

test('rejects a write with an invalid CSRF token', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => error(403, 'csrf_failed')),
  )

  await expect(api.signOut()).rejects.toMatchObject({ status: 403, code: 'csrf_failed' })
})

test('a 401 from a signed-in call goes to sign-in, a public one does not', async () => {
  const unauthorized = vi.fn<() => void>()
  setUnauthorizedHandler(unauthorized)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => error(401, 'unauthenticated')),
  )

  await expect(api.session()).rejects.toBeInstanceOf(ApiError)
  expect(unauthorized).toHaveBeenCalledTimes(1)

  await expect(api.startPasskeySignIn()).rejects.toBeInstanceOf(ApiError)
  expect(unauthorized).toHaveBeenCalledTimes(1)
})

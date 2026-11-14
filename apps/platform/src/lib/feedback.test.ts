import { setCsrfToken } from '@/lib/api'

import { feedbackApi, screenshotError } from './feedback'

// jsdom's File cannot go through Node's fetch, so the request is captured instead of served.
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(Response.json({ id: 'f1' }, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const png = (name: string, size = 3) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' })

test('sends the kind, trimmed description, page path and each screenshot with the CSRF token', async () => {
  setCsrfToken('tok')
  await expect(
    feedbackApi.send({
      kind: 'feature',
      description: '  More colours ',
      screenshots: [png('a.png'), png('b.png')],
    }),
  ).resolves.toEqual({ id: 'f1' })
  const [url, init] = fetchMock.mock.calls[0] ?? []
  const received = init?.body as FormData
  expect(url).toBe('/api/v1/feedback')
  expect(init?.headers).toMatchObject({ 'X-CSRF-Token': 'tok' })
  expect(received.get('kind')).toBe('feature')
  expect(received.get('description')).toBe('More colours')
  expect(received.get('page_path')).toBe(window.location.pathname)
  expect(received.getAll('screenshots[]').map((file) => (file as File).name)).toEqual([
    'a.png',
    'b.png',
  ])
})

test('surfaces the server message', async () => {
  fetchMock.mockResolvedValue(
    Response.json(
      { error: { code: 'rate_limited', message: 'Too many reports.' } },
      { status: 429 },
    ),
  )
  await expect(
    feedbackApi.send({ kind: 'problem', description: 'x', screenshots: [] }),
  ).rejects.toThrow('Too many reports.')
})

test('checks the count, type and size of screenshots', () => {
  expect(screenshotError([png('a.png')])).toBe('')
  expect(screenshotError(Array.from({ length: 6 }, (_, i) => png(`${i}.png`)))).toMatch(/at most 5/)
  expect(screenshotError([new File(['x'], 'n.gif', { type: 'image/gif' })])).toMatch(/n.gif/)
  expect(screenshotError([png('big.png', 5 * 1024 * 1024 + 1)])).toMatch(/big.png is larger/)
})

import { setCsrfToken } from '@/lib/api'

import { aiWrite, type AIWriteInput } from './ai-write'

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(Response.json({ data: { text: 'Monthly bookkeeping.' } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

test('posts the input and returns the written text', async () => {
  setCsrfToken('tok')
  const input: AIWriteInput = {
    field: 'engagement_description',
    action: 'draft',
    text: '',
    context: { name: 'Bookkeeping' },
  }
  await expect(aiWrite(input)).resolves.toBe('Monthly bookkeeping.')
  const [url, init] = fetchMock.mock.calls[0] ?? []
  expect(url).toBe('/api/v1/ai/write')
  expect(init?.method).toBe('POST')
  expect(init?.headers).toMatchObject({ 'X-CSRF-Token': 'tok' })
  expect(JSON.parse(String(init?.body))).toEqual(input)
})

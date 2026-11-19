import { ApiError, setCsrfToken } from '@/lib/api'

import { aiWrite, aiWriteError, type AIWriteInput } from './ai-write'

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

describe('aiWriteError', () => {
  it('never shows a raw 404', () =>
    expect(aiWriteError(new ApiError(404, 'not_found', 'Not found.'))).toEqual({
      message: "Write with AI isn't available on this server yet.",
      retry: false,
    }))
  it('offers a retry for busy and failed calls', () => {
    expect(aiWriteError(new ApiError(503, 'ai_busy', 'Busy.'))).toEqual({
      message: 'The AI is busy right now. Try again in a minute.',
      retry: true,
    })
    expect(aiWriteError(new ApiError(503, 'ai_failed', 'Server words.'))).toEqual({
      message: "The AI couldn't write this right now. Nothing was changed. Try again in a moment.",
      retry: true,
    })
    expect(aiWriteError(new TypeError('fetch failed')).retry).toBe(true)
  })
  it('keeps the quota message without a retry', () =>
    expect(aiWriteError(new ApiError(403, 'quota_exceeded', 'Used up.'))).toEqual({
      message: 'Used up.',
      retry: false,
    }))
})

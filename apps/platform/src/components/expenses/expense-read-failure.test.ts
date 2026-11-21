import { expect, test } from 'vitest'

import { ApiError } from '@/lib/api'

import { readFailure } from './expense-read-failure'

test.each([
  ['no_receipt', 'warning', 'No expense found', /yourself\.$/],
  ['multiple_receipts', 'warning', 'Several documents in one file', /yourself\.$/],
  ['no_readable_file', 'warning', 'No file to read', /yourself\.$/],
  ['ai_failed', 'danger', 'The file could not be read', /^Server text\.$/],
])('%s is a %s titled %s', (code, tone, title, body) => {
  expect(readFailure(new ApiError(422, code, 'Server text.'))).toMatchObject({
    tone,
    title,
    body: expect.stringMatching(body),
  })
})

test('a failure without an answer from the server is a real failure', () => {
  expect(readFailure(new TypeError('Failed to fetch'))).toMatchObject({
    tone: 'danger',
    body: 'Failed to fetch',
  })
})

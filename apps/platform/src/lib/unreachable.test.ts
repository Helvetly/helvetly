import { expect, test } from 'vitest'

import { ApiError } from '@/lib/api'

import { isUnreachable } from './unreachable'

test.each([
  [new ApiError(0, 'network_error', ''), true],
  [new ApiError(502, 'http_502', ''), true],
  [new ApiError(503, 'http_503', ''), true],
  [new ApiError(504, 'http_504', ''), true],
  [new ApiError(500, 'internal', ''), false],
  [new ApiError(422, 'validation_failed', ''), false],
  [new Error('boom'), false],
])('%o unreachable: %s', (error, expected) => {
  expect(isUnreachable(error)).toBe(expected)
})

import { renderHook } from '@testing-library/react'

import { useStableCallback } from './use-stable-callback'

test('keeps one identity and calls the latest function', () => {
  const { result, rerender } = renderHook(({ n }) => useStableCallback(() => n), {
    initialProps: { n: 1 },
  })
  const first = result.current
  rerender({ n: 2 })
  expect(result.current).toBe(first)
  expect(result.current()).toBe(2)
})

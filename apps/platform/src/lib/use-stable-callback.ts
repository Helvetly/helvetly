import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * `fn` behind an identity that never changes, so a memoised row keeps its props while the page
 * re-renders (opening a drawer). It calls the latest `fn`; call it from events, not during render.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const latest = useRef(fn)
  useLayoutEffect(() => {
    latest.current = fn
  })
  return useCallback((...args: A) => latest.current(...args), [])
}

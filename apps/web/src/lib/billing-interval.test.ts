import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chooseInterval, currentInterval, useBillingInterval } from './billing-interval'

afterEach(() => {
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('billing interval', () => {
  it('is yearly by default', () => expect(currentInterval()).toBe('year'))

  it('follows the address first, then the session', () => {
    sessionStorage.setItem('helvetly.billing', 'monthly')
    expect(currentInterval()).toBe('month')
    window.history.replaceState(null, '', '/pricing/?billing=yearly')
    expect(currentInterval()).toBe('year')
  })

  it('keeps a choice in the address and the session, and tells every caller', () => {
    const { result } = renderHook(useBillingInterval)
    expect(result.current[0]).toBe('year')
    act(() => result.current[1]('month'))
    expect(result.current[0]).toBe('month')
    expect(window.location.search).toBe('?billing=monthly')
    expect(sessionStorage.getItem('helvetly.billing')).toBe('monthly')
  })

  it('still chooses when the session cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    chooseInterval('month')
    expect(currentInterval()).toBe('month')
  })
})

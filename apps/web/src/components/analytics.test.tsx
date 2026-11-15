import { render } from '@testing-library/react'
import ReactGA from 'react-ga4'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Analytics } from './analytics'

describe('Analytics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['www.helvetly.com', 1],
    ['helvetly.com', 1],
    ['localhost', 0],
    ['helvetly.com.evil.example', 0],
  ])('on %s starts Google Analytics %i time(s)', (hostname, calls) => {
    const initialize = vi.spyOn(ReactGA, 'initialize').mockImplementation(() => {})
    vi.stubGlobal('location', { ...window.location, hostname })

    render(<Analytics />)

    expect(initialize).toHaveBeenCalledTimes(calls)
  })
})

import { render } from '@testing-library/react'
import ReactGA from 'react-ga4'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Analytics } from './analytics'

describe('Analytics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it.each([
    ['www.helvetly.com', 'G-TEST', [['G-TEST']]],
    ['helvetly.com', 'G-TEST', [['G-TEST']]],
    ['localhost', 'G-TEST', []],
    ['helvetly.com.evil.example', 'G-TEST', []],
    ['www.helvetly.com', '', []],
  ])('on %s with id "%s" starts Google Analytics with %j', (hostname, gaId, calls) => {
    const initialize = vi.spyOn(ReactGA, 'initialize').mockImplementation(() => {})
    vi.stubGlobal('location', { ...window.location, hostname })
    vi.stubEnv('NEXT_PUBLIC_GA_ID', gaId)

    render(<Analytics />)

    expect(initialize.mock.calls).toEqual(calls)
  })
})

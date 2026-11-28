import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Analytics, FALLBACK_MS } from './analytics'

const gtagScripts = () => [...document.head.querySelectorAll('script')].map((script) => script.src)

/** The page on `hostname`, built with `gaId`. */
const on = (hostname: string, gaId: string) => {
  vi.stubGlobal('location', { ...window.location, hostname })
  vi.stubEnv('NEXT_PUBLIC_GA_ID', gaId)
  return render(<Analytics />)
}

describe('Analytics', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    delete window.dataLayer
    for (const script of document.head.querySelectorAll('script')) script.remove()
  })

  it('loads nothing before the first interaction, then Google’s script once with the id', () => {
    on('www.helvetly.com', 'G-TEST')
    expect(gtagScripts()).toEqual([])
    fireEvent.pointerDown(window)
    fireEvent.scroll(window)
    expect(gtagScripts()).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-TEST'])
    const queued = (window.dataLayer ?? []).map((entry) => [...entry])
    expect(queued).toEqual([
      [
        'consent',
        'default',
        { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
      ],
      ['set', 'ads_data_redaction', true],
      ['js', expect.any(Date)],
      ['config', 'G-TEST', expect.objectContaining({ allow_google_signals: false })],
    ])
  })

  it('loads after the fallback time without an interaction', () => {
    on('helvetly.com', 'G-TEST')
    vi.advanceTimersByTime(FALLBACK_MS - 1)
    expect(gtagScripts()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(gtagScripts()).toHaveLength(1)
  })

  it.each([
    ['localhost', 'G-TEST'],
    ['helvetly.com.evil.example', 'G-TEST'],
    ['www.helvetly.com', ''],
  ])('on %s with id "%s" never loads', (hostname, gaId) => {
    on(hostname, gaId)
    fireEvent.keyDown(window)
    vi.advanceTimersByTime(FALLBACK_MS)
    expect(gtagScripts()).toEqual([])
  })

  it('loads nothing after the page unmounts', () => {
    on('www.helvetly.com', 'G-TEST').unmount()
    fireEvent.pointerDown(window)
    vi.advanceTimersByTime(FALLBACK_MS)
    expect(gtagScripts()).toEqual([])
  })
})

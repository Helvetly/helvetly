import { describe, expect, it } from 'vitest'

import { notFoundMetadata, pageMetadata } from './metadata'

describe('pageMetadata', () => {
  it('gives link previews the full title, the page URL and its language among the others', () => {
    const meta = pageMetadata('de', '/pricing', 'Preise', 'Beschreibung')
    expect(meta.title).toBe('Preise')
    expect(meta.alternates?.canonical).toBe('/de/preise')
    expect(meta.openGraph).toMatchObject({
      title: 'Preise · Helvetly',
      description: 'Beschreibung',
      url: '/de/preise',
      locale: 'de_CH',
      alternateLocale: ['en_GB', 'fr_CH', 'it_CH', 'nl_NL', 'cs_CZ', 'sv_SE'],
      images: [{ url: '/og.png', width: 1200, height: 630 }],
    })
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: 'Preise · Helvetly' })
  })

  it('keeps an absolute title as it is', () => {
    const meta = pageMetadata('en', '/', { absolute: 'Helvetly · Home' }, 'Text')
    expect(meta.openGraph?.title).toBe('Helvetly · Home')
    expect(meta.openGraph?.url).toBe('/')
  })
})

it('keeps missing pages out of search with a localized error title', () => {
  expect(notFoundMetadata('de')).toMatchObject({
    title: { absolute: expect.stringContaining('404') },
    robots: { index: false },
    alternates: null,
    openGraph: null,
    twitter: null,
  })
})

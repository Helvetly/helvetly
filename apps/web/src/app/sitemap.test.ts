import { describe, expect, it } from 'vitest'

import sitemap from './sitemap'

describe('sitemap language links', () => {
  it('offers language-wide and regional versions with English as the default', () => {
    const entries = sitemap().filter(({ url }) => url.endsWith('/pricing'))
    expect(entries).toHaveLength(7)
    for (const entry of entries) {
      expect(entry.alternates?.languages).toMatchObject({
        en: 'https://www.helvetly.com/pricing',
        'en-GB': 'https://www.helvetly.com/pricing',
        fr: 'https://www.helvetly.com/fr/pricing',
        'fr-CH': 'https://www.helvetly.com/fr/pricing',
        'x-default': 'https://www.helvetly.com/pricing',
      })
      expect(Object.keys(entry.alternates?.languages ?? {})).toHaveLength(15)
    }
  })
})

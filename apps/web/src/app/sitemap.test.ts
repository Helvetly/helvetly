import { defaultLocale, isLocale, locales, localizedHref } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'
import { describe, expect, it } from 'vitest'

import { publicPaths } from '@/lib/public-paths'

import slugs from '../../../../packages/i18n/src/route-slugs.json'
import { GET } from './%5Fredirects/route'
import sitemap from './sitemap'

describe('sitemap language links', () => {
  it('offers language-wide and regional versions of the same guide with English as the default', () => {
    const original = 'https://www.helvetly.com/guides/back-office-software-for-small-businesses'
    const entries = sitemap().filter(
      ({ alternates }) => alternates?.languages?.['x-default'] === original,
    )
    expect(entries).toHaveLength(7)
    for (const entry of entries) {
      expect(entry.alternates?.languages).toMatchObject({
        en: original,
        'en-GB': original,
        de: 'https://www.helvetly.com/de/ratgeber/backoffice-software-fuer-kleinunternehmen',
        'it-CH': 'https://www.helvetly.com/it/guide/software-gestionale-per-piccole-imprese',
        'x-default': original,
      })
      expect(Object.values(entry.alternates?.languages ?? {})).toContain(entry.url)
      expect(Object.keys(entry.alternates?.languages ?? {})).toHaveLength(15)
    }
  })

  it('has pinned slugs for every page except the home and competitor brand names', () => {
    const paths = publicPaths().filter((path) => path !== '/' && !path.startsWith('/compare/'))
    expect(Object.keys(slugs).toSorted()).toEqual([...paths, '/help/topic'].toSorted())
    for (const translations of Object.values(slugs))
      for (const slug of Object.values(translations))
        expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('gives every public page a unique URL and redirects each displaced URL directly to it', async () => {
    const rules = new Set((await GET().text()).trim().split('\n'))
    const paths = publicPaths()
    for (const lang of Object.keys(locales).filter(isLocale)) {
      const published = new Set(paths.map((path) => publicHref(path, lang)))
      expect(published.size).toBe(paths.length)
      for (const path of paths) {
        const old = localizedHref(path, lang)
        const target = publicHref(path, lang)
        if (old === target) continue
        expect(lang).not.toBe(defaultLocale)
        expect(published.has(old)).toBe(false)
        for (const alias of [old, old + '/', old + '.html']) {
          expect(rules.delete(`${alias} ${target} 301`)).toBe(true)
        }
      }
    }
    expect(rules.size).toBe(0)
  })
})

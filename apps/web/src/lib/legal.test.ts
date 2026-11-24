import { describe, expect, it } from 'vitest'

import { isLegalSlug, LEGAL, legalHref, readLegal, slugify } from './legal'

describe('legal', () => {
  it.each(Object.keys(LEGAL).filter(isLegalSlug))('reads %s without its title line', (slug) => {
    const { markdown } = readLegal(slug, 'en')
    expect(markdown).not.toMatch(/^# /)
    // a bracket not followed by a link target is an unfilled placeholder
    expect(markdown).not.toMatch(/DRAFT|TBD|\[[^\]]*\](?!\()/)
  })

  it.each(
    (['de', 'fr', 'it', 'nl', 'cs', 'sv'] as const).flatMap((language) =>
      Object.keys(LEGAL)
        .filter(isLegalSlug)
        .map((slug) => [language, slug] as const),
    ),
  )('reads the %s %s text with its own section anchors', (language, slug) => {
    const english = readLegal(slug, 'en')
    const local = readLegal(slug, language)
    expect(local.markdown).not.toBe(english.markdown)
    expect(local.markdown).not.toMatch(/^# /)
    expect(local.headings).toHaveLength(english.headings.length)
    for (const heading of local.headings) expect(heading.id).toBe(slugify(heading.text))
  })

  it('lists the numbered sections as headings', () => {
    expect(readLegal('terms', 'en').headings[0]).toEqual({
      text: '1. Parties and scope',
      id: '1-parties-and-scope',
    })
  })

  it('maps links between the files to the pages', () => {
    expect(legalHref('dpa.md')).toBe('/dpa')
    expect(legalHref('privacy-policy.md#2-two-roles')).toBe('/privacy#2-two-roles')
    expect(legalHref('https://example.com')).toBe('https://example.com')
    expect(legalHref('#3-plans')).toBe('#3-plans')
  })

  it('slugs headings like GitHub does for plain text', () => {
    expect(slugify('3. What we process, why & how')).toBe('3-what-we-process-why--how')
    expect(slugify('Änderungen (AGB)')).toBe('änderungen-agb')
  })
})

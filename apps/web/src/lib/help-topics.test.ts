import { describe, expect, it } from 'vitest'

import { readCollection } from './content'
import { helpTopicsIn, POPULAR_HELP, topicSlug, topicsWithArticles } from './help-topics'

describe('help topics', () => {
  const help = readCollection('help', 'en')

  it('give every help article a known topic', () => {
    const names = new Set(helpTopicsIn('en').map((t) => t.name))
    expect(help.filter((a) => !names.has(a.category)).map((a) => a.slug)).toEqual([])
    expect(topicsWithArticles(help, 'en').flatMap((t) => t.articles)).toHaveLength(help.length)
  })

  it('list only popular articles that exist', () => {
    const slugs = new Set(help.map((a) => a.slug))
    expect(POPULAR_HELP.filter((slug) => !slugs.has(slug))).toEqual([])
  })

  it('make readable topic slugs', () => {
    expect(topicSlug('Invoices and getting paid')).toBe('invoices-and-getting-paid')
    expect(topicSlug('VAT and books')).toBe('vat-and-books')
  })
})

import { describe, expect, it } from 'vitest'

import { byCategory, formatDay, parseFrontMatter, readCollection } from './content'

describe('content', () => {
  const guides = readCollection('guides')
  const help = readCollection('help')

  it('reads every guide and help article with its front matter', () => {
    expect(guides.length).toBeGreaterThanOrEqual(6)
    expect(help.length).toBeGreaterThanOrEqual(40)
    const wrong = [...guides, ...help]
      .filter(
        (a) =>
          a.description.length > 160 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(a.updated) ||
          a.markdown.startsWith('# '),
      )
      .map((a) => a.slug)
    expect(wrong).toEqual([])
  })

  it('links only to guides and help articles that exist', () => {
    const slugs = {
      guides: new Set(guides.map((g) => g.slug)),
      help: new Set(help.map((h) => h.slug)),
    }
    const broken = [...guides, ...help].flatMap((article) =>
      [...article.markdown.matchAll(/\]\(\/(guides|help)\/([a-z0-9-]+)/g)]
        .filter(([, kind, slug]) => !slugs[kind === 'guides' ? 'guides' : 'help'].has(slug ?? ''))
        .map(([link]) => `${article.slug}: ${link}`),
    )
    expect(broken).toEqual([])
  })

  it('refuses a file without its front matter', () => {
    expect(() => parseFrontMatter('no front matter', 'x.md')).toThrow('missing front matter')
    expect(() => parseFrontMatter('---\ntitle: A\n---\nbody', 'x.md').field('category')).toThrow(
      'needs "category"',
    )
  })

  it('groups by the given category order, unknown ones last', () => {
    const groups = byCategory(help, ['Getting started', 'Clients'])
    expect(groups.slice(0, 2).map((g) => g.category)).toEqual(['Getting started', 'Clients'])
    expect(groups.flatMap((g) => g.articles)).toHaveLength(help.length)
  })

  it('writes a day as people read it', () => {
    expect(formatDay('2026-11-11')).toBe('11 November 2026')
  })
})

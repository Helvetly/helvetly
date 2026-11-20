import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { defaultLocale, isLocale, locales, localizedHref } from '@helvetly/i18n'
import { describe, expect, it } from 'vitest'

import { compareIn } from '@/lib/compare'
import { readCollection } from '@/lib/content'
import { translatorFor } from '@/lib/i18n'
import { llmsTxt } from '@/lib/llms'

// apps/web, wherever the tests run (apps/web or the repository root), as lib/content.ts finds it.
const web = existsSync(join(process.cwd(), 'apps/web'))
  ? join(process.cwd(), 'apps/web')
  : process.cwd()
const repo = join(web, '../..')

describe('llms.txt', () => {
  const text = llmsTxt()

  it('describes the whole back office and links every language with its own summary', () => {
    expect(text).toContain(translatorFor('en')('whatIsHelvetlyAnswer'))
    expect(text).toContain('EU hosting (Frankfurt)')
    expect(text).not.toContain('hosting in Switzerland')
    for (const language of Object.keys(locales).filter(isLocale)) {
      expect(text).toContain(`https://www.helvetly.com${localizedHref('/', language)}`)
      expect(text).toContain(translatorFor(language)('metaHomeDescription'))
    }
  })

  it('follows llmstxt.org: one H1, a summary quote, then link lists', () => {
    expect(text.match(/^# /gm)).toHaveLength(1)
    expect(text.split('\n')[2]).toMatch(/^> /)
    for (const line of text.split('\n').filter((l) => l.startsWith('- ')))
      expect(line).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^)]+\)(: .+)?$/)
  })

  it('lists every guide and help article', () => {
    for (const collection of ['guides', 'help'] as const)
      for (const article of readCollection(collection, defaultLocale))
        expect(text).toContain(`/${collection}/${article.slug})`)
  })

  it('lists every comparison', () => {
    for (const { slug } of compareIn(defaultLocale).COMPETITORS)
      expect(text).toContain(`/compare/${slug})`)
  })
})

describe('the ARD manifest', () => {
  const manifest = readFileSync(join(web, 'public/.well-known/ard.json'), 'utf8')

  it('names the protocol versions the MCP server speaks', () => {
    const go = readFileSync(join(repo, 'apps/api/internal/mcp/mcp.go'), 'utf8')
    const versions = /var versions = \[\]string\{([^}]*)\}/.exec(go)?.[1]?.match(/"[^"]+"/g)
    expect(versions?.length).toBeGreaterThan(0)
    const card: unknown = JSON.parse(manifest)
    expect(JSON.stringify(card)).toContain(`"supportedProtocolVersions":[${versions?.join(',')}]`)
  })
})

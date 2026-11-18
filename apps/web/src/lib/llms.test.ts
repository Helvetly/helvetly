import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { defaultLocale } from '@helvetly/i18n'
import { describe, expect, it } from 'vitest'

import { readCollection } from '@/lib/content'
import { llmsTxt } from '@/lib/llms'

const repo = join(process.cwd().replace(/\/apps\/web$/, ''))

describe('llms.txt', () => {
  const text = llmsTxt()

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
})

describe('the ARD manifest', () => {
  const manifest = readFileSync(join(process.cwd(), 'public/.well-known/ard.json'), 'utf8')

  it('names the protocol versions the MCP server speaks', () => {
    const go = readFileSync(join(repo, 'apps/api/internal/mcp/mcp.go'), 'utf8')
    const versions = /var versions = \[\]string\{([^}]*)\}/.exec(go)?.[1]?.match(/"[^"]+"/g)
    expect(versions?.length).toBeGreaterThan(0)
    const card: unknown = JSON.parse(manifest)
    expect(JSON.stringify(card)).toContain(`"supportedProtocolVersions":[${versions?.join(',')}]`)
  })
})

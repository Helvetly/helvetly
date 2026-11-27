import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import config from '../../../packages/i18n/src/locales.json' with { type: 'json' }

const out = new URL('../out/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, out), 'utf8')
const site = 'https://www.helvetly.com'
const platform = new URL(process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'http://localhost:8000').origin

function languageOf(pathname: string) {
  const prefix = pathname.split('/')[1] ?? ''
  return Object.keys(config.locales).find((lang) => lang === prefix) ?? config.defaultLocale
}

test('every sitemap URL is a final static page with reciprocal, localized metadata', () => {
  const entries = [...read('sitemap.xml').matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([entry]) => ({
    url: /<loc>([^<]+)<\/loc>/.exec(entry)?.[1] ?? '',
    alternates: Object.fromEntries(
      [...entry.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(
        ([, tag, href]): [string, string] => [tag ?? '', href ?? ''],
      ),
    ),
  }))
  assert.ok(entries.length > 0, 'sitemap has pages')
  const byUrl = new Map(entries.map(({ url, alternates }) => [url, alternates]))
  assert.equal(byUrl.size, entries.length, 'sitemap URLs are unique')
  const redirects = new Set(
    read('_redirects')
      .trim()
      .split('\n')
      .map((line) => line.split(' ')[0]),
  )
  for (const url of byUrl.keys()) {
    const { pathname } = new URL(url)
    if (pathname !== '/' && pathname.endsWith('/')) redirects.add(pathname.slice(0, -1))
  }
  const metadata = new Map<string, { title: string; description: string }>()

  for (const { url, alternates } of entries) {
    const { origin, pathname, search, hash } = new URL(url)
    const path = pathname.slice(1)
    const directory = pathname.endsWith('/')
    // Cloudflare serves clean URLs from page.html and slash-terminated directories from index.html.
    assert.equal(url, origin + pathname)
    assert.equal(origin, site)
    assert.equal(search + hash, '')
    assert.ok(!redirects.has(pathname), `Sitemap contains a redirect: ${url}`)
    if (!directory) {
      assert.doesNotMatch(pathname, /\.|\/index$/, url)
      assert.ok(!existsSync(new URL(`${path}/index.html`, out)), `${url} needs a trailing slash`)
    }
    const html = read(directory ? `${path}index.html` : `${path}.html`)
    const head = html.split('</head>', 1)[0] ?? ''
    const lang = languageOf(pathname)
    assert.ok(head.includes(`<html lang="${lang}"`), `${url} has the wrong html lang`)
    assert.doesNotMatch(
      head,
      /<meta (?:http-equiv="refresh"|name="robots" content="[^"]*noindex)/i,
      url,
    )
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(head)?.[1]
    assert.ok(canonical, `${url} has no canonical`)
    assert.equal(new URL(canonical).href, url, `${url} must canonicalize to itself`)

    const pageAlternates = Object.fromEntries(
      [...head.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(
        ([, tag, href]) => [tag, new URL(href ?? '').href],
      ),
    )
    assert.deepEqual(pageAlternates, alternates, `${url} has inconsistent hreflang`)
    assert.equal(alternates[lang], url)
    assert.equal(alternates['x-default'], alternates[config.defaultLocale])
    assert.ok(alternates['x-default'], `${url} has no x-default`)
    for (const alternate of new Set(Object.values(alternates))) {
      const code = languageOf(new URL(alternate).pathname)
      assert.equal(alternates[code], alternate)
      const details = Object.entries(config.locales).find(([locale]) => locale === code)?.[1]
      assert.ok(details)
      assert.equal(alternates[details.languageTag], alternate)
      assert.deepEqual(byUrl.get(alternate), alternates, `${url} → ${alternate} is not reciprocal`)
    }

    const title = /<title>([^<]+)<\/title>/.exec(head)?.[1]
    const description = /<meta name="description" content="([^"]+)"/.exec(head)?.[1]
    assert.ok(title && description, `${url} needs a title and description`)
    metadata.set(url, { title, description })

    const markup = html.replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, '')
    for (const [anchor, href] of markup.matchAll(/<a\b[^>]*\shref="([^"]+)"[^>]*>/g)) {
      const target = new URL(href ?? '', url)
      if (target.origin === site)
        assert.ok(!redirects.has(target.pathname), `${url} links to a redirect: ${href}`)
      if (target.origin === platform && /^\/(?:login|settings\/api)(?:\/|$)/.test(target.pathname))
        assert.match(anchor, /\srel="nofollow"/, `${url} links to ${href} without nofollow`)
    }
  }

  for (const { url, alternates } of entries) {
    const english = alternates['x-default'] ?? ''
    if (url === english) continue
    assert.notEqual(
      metadata.get(url)?.title,
      metadata.get(english)?.title,
      `${url} has an English title`,
    )
    assert.notEqual(
      metadata.get(url)?.description,
      metadata.get(english)?.description,
      `${url} has an English description`,
    )
  }
})

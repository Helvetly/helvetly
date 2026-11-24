import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTranslator, localeDetails, type Locale } from '@helvetly/i18n'
import { describe, expect, it } from 'vitest'

import en from '../messages/en.json'
import { isLegalSlug, LEGAL, readLegal, slugify } from './legal'

// Every public language besides English.
const TRANSLATED = ['de', 'fr', 'it', 'nl', 'cs', 'sv'] as const satisfies readonly Locale[]

const messages = (file: string) => join(import.meta.dirname, '../messages', file)
const content = join(import.meta.dirname, '../../content')

function catalog(language: Locale): Record<string, string> {
  const file = messages(`${language}.json`)
  if (!existsSync(file)) throw new Error(`${file} is missing`)
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${file} is not an object`)
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
}

const parameters = (value: string) =>
  [...value.matchAll(/\{(\w+)(?:\}|,)/g)].map((match) => match[1]).toSorted()

describe.each(TRANSLATED)('%s marketing catalog', (language) => {
  it('covers every English message with valid ICU and the same values', () => {
    const translated = catalog(language)
    expect(Object.keys(translated).toSorted()).toEqual(Object.keys(en).toSorted())
    const translate = createTranslator<Record<string, string>>(
      en,
      localeDetails(language).languageTag,
      translated,
    )
    for (const [key, source] of Object.entries(en)) {
      const message = translated[key] ?? ''
      expect({ key, values: parameters(message) }).toEqual({ key, values: parameters(source) })
      expect(message).not.toMatch(/ZX[QV]\d|TODO|TBD/)
      const values = Object.fromEntries(parameters(source).map((name) => [name, 3]))
      expect(() => translate(key, values)).not.toThrow()
    }
  })

  it('is not an English copy', () => {
    const translated = catalog(language)
    const worded = Object.entries(en).filter(([, source]) => /\p{L}{4}/u.test(source))
    const copied = worded.filter(([key, source]) => translated[key] === source)
    // Product, plan and company names stay as they are; German keeps under 5 % of messages unchanged.
    expect(copied.length / worded.length).toBeLessThan(0.15)
  })
})

it('writes Swiss German without ß', () => {
  expect(Object.values(catalog('de')).filter((message) => /[ßẞ]/.test(message))).toEqual([])
})

/** The front matter fields and the body of a Markdown file. */
function parse(file: string) {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(readFileSync(file, 'utf8'))
  const fields = new Map<string, string>()
  for (const line of (match?.[1] ?? '').split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return { fields, body: match ? (match[2] ?? '') : readFileSync(file, 'utf8') }
}

const englishFiles = (collection: string) =>
  readdirSync(join(content, collection))
    .filter((file) => file.endsWith('.md'))
    .toSorted()

const fences = (markdown: string) => [...markdown.matchAll(/```[\s\S]*?```/g)].map((m) => m[0])
const sitePaths = (markdown: string) =>
  [...markdown.matchAll(/\]\((\/[^)\s#]*)/g)].map((m) => m[1]).toSorted()
const headings = (markdown: string, level: string) =>
  (markdown.match(new RegExp(`^${level} `, 'gm')) ?? []).length
/** Prices and percentages as bare digits, whatever the language's separators. */
const figures = (markdown: string) =>
  [
    ...markdown.matchAll(
      /(?:CHF|EUR)\s?\d{1,3}(?:[’'.,\s  ]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?%/g,
    ),
  ]
    .map((m) => m[0].replace(/[^\d%]/g, ''))
    .toSorted()

const PLACEHOLDER = /\b(?:TODO|TBD|DRAFT|FIXME)\b|XXX|[Ll]orem ipsum|\[\[|\]\]/

describe.each([
  ['help', ['category', 'order', 'updated']],
  ['guides', ['category', 'updated', 'readingMinutes']],
  ['legal', []],
] as const)('%s translations', (collection, kept) => {
  const files = englishFiles(collection)

  it.each(TRANSLATED)('%s translates every English file and nothing else', (language) => {
    const directory = join(content, collection, language)
    expect(existsSync(directory) ? readdirSync(directory).toSorted() : []).toEqual(files)
  })

  const translated = TRANSLATED.flatMap((language) =>
    files
      .filter((file) => existsSync(join(content, collection, language, file)))
      .map((file) => [language, file] as const),
  )

  it.each(translated)('%s/%s keeps the facts, code, links and structure', (language, file) => {
    const english = parse(join(content, collection, file))
    const local = parse(join(content, collection, language, file))
    for (const field of kept) {
      expect({ field, value: local.fields.get(field) }).toEqual({
        field,
        value: english.fields.get(field),
      })
    }
    for (const field of collection === 'legal' ? [] : ['title', 'description']) {
      const value = local.fields.get(field) ?? ''
      expect({ field, value }).not.toEqual({ field, value: '' })
      expect({ field, value }).not.toEqual({ field, value: english.fields.get(field) })
    }
    expect(local.body).not.toBe(english.body)
    expect(local.body).not.toMatch(PLACEHOLDER)
    expect(fences(local.body)).toEqual(fences(english.body))
    expect(sitePaths(local.body)).toEqual(sitePaths(english.body))
    expect([headings(local.body, '##'), headings(local.body, '###')]).toEqual([
      headings(english.body, '##'),
      headings(english.body, '###'),
    ])
    // German guides spell some amounts out; help and legal texts state them as figures.
    const stated = collection !== 'guides'
    expect(stated ? figures(local.body) : []).toEqual(stated ? figures(english.body) : [])
  })
})

const legalSlug = (target: string) =>
  Object.keys(LEGAL)
    .filter(isLegalSlug)
    .find((slug) => LEGAL[slug].file === target || `/${slug}` === target)

describe.each(TRANSLATED)('%s anchors', (language) => {
  // Every heading id of a legal page in the language, as the page renders it.
  const ids = new Map(
    Object.keys(LEGAL)
      .filter(isLegalSlug)
      .map((slug) => [
        slug,
        new Set(
          [...readLegal(slug, language).markdown.matchAll(/^#{2,6} (.+)$/gm)].map((m) =>
            slugify(m[1] ?? ''),
          ),
        ),
      ]),
  )
  const sources = ['help', 'guides', 'legal'].flatMap((collection) =>
    englishFiles(collection).map((file) => [collection, file] as const),
  )

  it('links only to sections that exist in the same language', () => {
    const broken = sources.flatMap(([collection, file]) => {
      const path = join(content, collection, language, file)
      if (!existsSync(path)) return []
      const self = collection === 'legal' ? legalSlug(file) : undefined
      return [...readFileSync(path, 'utf8').matchAll(/\]\(([^)\s#]*)#([^)\s]+)\)/g)].flatMap(
        ([link, target = '', fragment = '']) => {
          const slug = target === '' ? self : legalSlug(target)
          if (!slug) return []
          return ids.get(slug)?.has(decodeURIComponent(fragment)) ? [] : [`${file}: ${link}`]
        },
      )
    })
    expect(broken).toEqual([])
  })
})

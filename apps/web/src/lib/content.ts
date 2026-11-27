import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { defaultLocale, type Locale, localeDetails } from '@helvetly/i18n'

import { localizedContentFile } from '@/lib/content-locale'
import { translatorFor } from '@/lib/i18n'
import { slugify } from '@/lib/legal'

// Messages for whoever runs the build, not for readers.
const translate = translatorFor(defaultLocale)

// Guides and help articles are Markdown files in apps/web/content/<collection>, each with a small front
// matter block. Pages are static, so the files are read at build time only.

export type Collection = 'guides' | 'help'

export type Article = {
  slug: string
  title: string
  description: string
  category: string
  updated: string
  /** Sorts articles inside a category (help). */
  order: number
  /** Shown on guides. */
  readingMinutes: number | null
  markdown: string
  headings: { text: string; id: string }[]
}

// apps/web/content from wherever the build or test runs (apps/web or the repository root).
function contentDir(collection: Collection, from = process.cwd()): string {
  for (const dir of [join(from, 'content', collection), join(from, 'apps/web/content', collection)])
    if (existsSync(dir)) return dir
  const parent = dirname(from)
  if (parent === from)
    throw new Error(
      translate('contentNotFoundAbove', { collection: collection, value2: process.cwd() }),
    )
  return contentDir(collection, parent)
}

/** Splits `---\nkey: value\n---\nbody` into its fields and body; every listed field is required. */
export function parseFrontMatter(source: string, file: string) {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(source)
  if (!match) throw new Error(translate('missingFrontMatter', { file: file }))
  const fields = new Map<string, string>()
  for (const line of (match[1] ?? '').split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  const field = (key: string) => {
    const value = fields.get(key)
    if (!value) throw new Error(translate('frontMatterNeeds', { file: file, key: key }))
    return value
  }
  return { field, optional: (key: string) => fields.get(key), body: match[2] ?? '' }
}

export function hasArticleTranslation(collection: Collection, slug: string, language: Locale) {
  return existsSync(join(contentDir(collection), language, `${slug}.md`))
}

function read(collection: Collection, file: string, language: Locale): Article {
  const { field, optional, body } = parseFrontMatter(
    readFileSync(localizedContentFile(contentDir(collection), file, language), 'utf8'),
    file,
  )
  const markdown = body.replace(/^# .*\n+/, '')
  return {
    slug: file.replace(/\.md$/, ''),
    title: field('title'),
    description: field('description'),
    category: parseFrontMatter(
      readFileSync(join(contentDir(collection), file), 'utf8'),
      file,
    ).field('category'),
    updated: field('updated'),
    order: Number(optional('order') ?? 0),
    readingMinutes: optional('readingMinutes') ? Number(optional('readingMinutes')) : null,
    markdown,
    headings: [...markdown.matchAll(/^## (.+)$/gm)].map((m) => {
      const text = (m[1] ?? '').trim()
      return { text, id: slugify(text) }
    }),
  }
}

/** Every article of a collection, by category then order then title. */
export function readCollection(collection: Collection, language: Locale): Article[] {
  return readdirSync(contentDir(collection))
    .filter((file) => file.endsWith('.md'))
    .map((file) => read(collection, file, language))
    .toSorted(
      (a, b) =>
        a.category.localeCompare(b.category) || a.order - b.order || a.title.localeCompare(b.title),
    )
}

export function readArticle(
  collection: Collection,
  slug: string,
  language: Locale,
): Article | undefined {
  return readCollection(collection, language).find((article) => article.slug === slug)
}

/** Articles grouped by category, in the order the categories are listed. */
export function byCategory(articles: Article[], order: string[]) {
  const known = order.filter((category) => articles.some((a) => a.category === category))
  const rest = [...new Set(articles.map((a) => a.category))].filter((c) => !order.includes(c))
  return [...known, ...rest].map((category) => ({
    category,
    articles: articles.filter((a) => a.category === category),
  }))
}

/** "11 November 2026" from "2026-11-11". */
export function formatDay(iso: string, language: Locale) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(localeDetails(language).languageTag, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

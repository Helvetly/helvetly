import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { defaultLocale, type Locale } from '@helvetly/i18n'

import { localizedContentFile } from '@/lib/content-locale'
import { perLanguage, translatorFor } from '@/lib/i18n'

// The legal texts the site publishes, in apps/web/content/legal (kept in step with the code); the site renders them
// at build time. Each page is static, so nothing is read at request time.
export const LEGAL = {
  terms: { file: 'terms.md' },
  privacy: { file: 'privacy-policy.md' },
  dpa: { file: 'dpa.md' },
  subprocessors: { file: 'subprocessors.md' },
  imprint: { file: 'imprint.md' },
} as const

export type LegalSlug = keyof typeof LEGAL

export const legalTitlesIn = perLanguage((translate): Record<LegalSlug, string> => ({
  terms: translate('termsOfService'),
  privacy: translate('privacyPolicy2'),
  dpa: translate('dataProcessingAgreement2'),
  subprocessors: translate('subprocessors'),
  imprint: translate('imprint'),
}))

export function isLegalSlug(value: string): value is LegalSlug {
  return Object.hasOwn(LEGAL, value)
}

// apps/web/content/legal from wherever the build or test runs (apps/web or the repository root).
function legalDir(from = process.cwd()): string {
  for (const dir of [join(from, 'content/legal'), join(from, 'apps/web/content/legal')]) {
    if (existsSync(dir)) return dir
  }
  const parent = dirname(from)
  if (parent === from)
    throw new Error(
      translatorFor(defaultLocale)('appsWebContentLegalNotFoundAbove') + process.cwd(),
    )
  return legalDir(parent)
}

export function hasLegalTranslation(slug: LegalSlug, language: Locale) {
  return existsSync(join(legalDir(), language, LEGAL[slug].file))
}

export function readLegal(slug: LegalSlug, language: Locale) {
  // The file's own `# Title` is dropped: the page sets the title as its one h1.
  const markdown = readFileSync(
    localizedContentFile(legalDir(), LEGAL[slug].file, language),
    'utf8',
  ).replace(/^# .*\n+/, '')
  const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => {
    const text = (m[1] ?? '').trim()
    return { text, id: slugify(text) }
  })
  return { markdown, headings }
}

/** GitHub's heading anchors: lower case, punctuation dropped, every space a hyphen. */
export function slugify(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** A link between the Markdown files (`dpa.md#6-…`) becomes the page that renders it (`/dpa#6-…`). */
export function legalHref(href: string) {
  const [path = '', hash] = href.split('#')
  const slug = Object.keys(LEGAL)
    .filter(isLegalSlug)
    .find((key) => LEGAL[key].file === path)
  if (!slug) return href
  return hash ? `/${slug}#${hash}` : `/${slug}`
}

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { localizedContentFile } from '@/lib/content-locale'
import { translate } from '@/lib/i18n'

// The legal texts the site publishes, in apps/web/content/legal (kept in step with the code); the site renders them
// at build time. Each page is static, so nothing is read at request time.
export const LEGAL = {
  terms: { file: 'terms.md', title: translate('termsOfService') },
  privacy: { file: 'privacy-policy.md', title: translate('privacyPolicy2') },
  dpa: { file: 'dpa.md', title: translate('dataProcessingAgreement2') },
  subprocessors: { file: 'subprocessors.md', title: translate('subprocessors') },
  imprint: { file: 'imprint.md', title: translate('imprint') },
} as const

export type LegalSlug = keyof typeof LEGAL

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
    throw new Error(translate('appsWebContentLegalNotFoundAbove') + process.cwd())
  return legalDir(parent)
}

export function readLegal(slug: LegalSlug) {
  // The file's own `# Title` is dropped: the page sets the title as its one h1.
  const markdown = readFileSync(localizedContentFile(legalDir(), LEGAL[slug].file), 'utf8').replace(
    /^# .*\n+/,
    '',
  )
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

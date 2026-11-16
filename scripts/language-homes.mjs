#!/usr/bin/env node
// Moves each prefixed language's home page of the website's static export (out/de.html) to out/de/index.html, after
// `next build` of apps/web. Its address is /de/ (localizedHref, hreflang, canonical), which the static host serves
// from de/index.html; a de.html would answer /de and send /de/ there instead.
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function moveLanguageHomes(root, languages) {
  for (const language of languages) {
    const page = join(root, `${language}.html`)
    if (!existsSync(page)) throw new Error(`${page} not found: run \`next build\` first`)
    renameSync(page, join(root, language, 'index.html'))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { defaultLocale, locales } = JSON.parse(
    readFileSync(new URL('../packages/i18n/src/locales.json', import.meta.url), 'utf8'),
  )
  moveLanguageHomes(
    resolve(process.argv[2] ?? 'out'),
    Object.keys(locales).filter((language) => language !== defaultLocale),
  )
}

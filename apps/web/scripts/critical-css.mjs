#!/usr/bin/env node
// Critical CSS of the website's static export, after `next build`: each page gets the rules its own markup uses
// inlined in <head>, and the full stylesheet (one per build, cached for a year) loads without blocking the first paint
// (media="print", switched to "all" once loaded; the CSP allows the inline handler). A visitor without JavaScript gets
// it through <noscript>.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import Beasties from 'beasties'

/** Every .html file under `dir`. */
function pages(dir) {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.html'))
    .map((file) => join(dir, file))
}

export async function inlineCriticalCss(root) {
  const beasties = new Beasties({
    path: root,
    publicPath: '/',
    preload: 'media',
    noscriptFallback: true,
    // The stylesheet is shared by every page: pruning it for one page would break the others.
    pruneSource: false,
    // Theme variables and keyframes the inlined rules refer to stay with them.
    keyframes: 'critical',
    logLevel: 'warn',
  })
  const files = pages(root)
  for (const file of files) {
    writeFileSync(file, await beasties.process(readFileSync(file, 'utf8')))
  }
  return files.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const count = await inlineCriticalCss(resolve(process.argv[2] ?? 'out'))
  console.log(`✓ critical CSS: ${count} pages`)
}

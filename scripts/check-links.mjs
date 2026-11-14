#!/usr/bin/env node
// Verifies every internal link in a static export (the directory given, default ./out): the target page or file
// must exist, and a #fragment must match an id on the target page. Runs after `next build` of apps/web; exits
// non-zero on any broken link.
import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'out')

async function walk(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name)
    out.push(...(e.isDirectory() ? await walk(p) : [p]))
  }
  return out
}

const isFile = (p) =>
  stat(p).then(
    (s) => s.isFile(),
    () => false,
  )

async function resolvePage(pathname) {
  const base = resolve(root, '.' + decodeURIComponent(pathname))
  for (const candidate of [base, `${base}.html`, resolve(base, 'index.html')]) {
    if (await isFile(candidate)) return candidate
  }
  return null
}

const idCache = new Map()
async function ids(file) {
  if (!idCache.has(file)) {
    const src = await readFile(file, 'utf8')
    idCache.set(file, new Set([...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])))
  }
  return idCache.get(file)
}

/** The markup without <script> elements, so strings inside the RSC payload do not count as links. */
function markupOf(src) {
  let markup = src
  let prev
  do {
    prev = markup
    markup = markup.replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, '')
  } while (markup !== prev)
  return markup
}

const files = await walk(root).catch(() => {
  console.error(`${root} not found: run \`next build\` first`)
  process.exit(1)
})
const broken = []
let checked = 0

for (const page of files.filter((f) => f.endsWith('.html'))) {
  const markup = markupOf(await readFile(page, 'utf8'))
  for (const m of markup.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const raw = m[1].replaceAll('&amp;', '&')
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue // external, mailto:, data:
    const url = new URL(raw, `http://x/${relative(root, page).replace(/(index)?\.html$/, '')}`)
    const target = raw.startsWith('#') ? page : await resolvePage(url.pathname)
    checked++
    if (!target) {
      broken.push(`${relative(root, page)} → ${raw} (missing page)`)
      continue
    }
    const fragment = decodeURIComponent(url.hash.slice(1))
    if (fragment && target.endsWith('.html') && !(await ids(target)).has(fragment)) {
      broken.push(`${relative(root, page)} → ${raw} (missing #${fragment})`)
    }
  }
}

if (broken.length > 0) {
  console.error(
    `✗ ${broken.length} broken internal link(s):\n  ${[...new Set(broken)].join('\n  ')}`,
  )
  process.exit(1)
}
console.log(`✓ link check: ${checked} internal links, none broken`)

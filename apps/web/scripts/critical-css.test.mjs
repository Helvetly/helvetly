import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { inlineCriticalCss } from './critical-css.mjs'

/** A page of the export with the shared stylesheet. */
const page = (body) =>
  `<!doctype html><html><head><link rel="stylesheet" href="/_next/site.css"></head><body>${body}</body></html>`

test('inlines the rules a page uses and loads the stylesheet without blocking', async () => {
  const out = mkdtempSync(join(tmpdir(), 'helvetly-critical-'))
  try {
    mkdirSync(join(out, '_next'))
    mkdirSync(join(out, 'de'))
    writeFileSync(join(out, '_next/site.css'), '.used{color:red}.unused{color:blue}')
    writeFileSync(join(out, 'index.html'), page('<p class="used">Hi</p>'))
    writeFileSync(join(out, 'de/index.html'), page('<p class="unused">Hallo</p>'))

    assert.equal(await inlineCriticalCss(out), 2)

    const home = readFileSync(join(out, 'index.html'), 'utf8')
    assert.match(home, /<style>\.used\{color:red\}<\/style>/)
    assert.doesNotMatch(home, /\.unused/)
    assert.match(
      home,
      /<link rel="stylesheet" href="\/_next\/site.css" media="print" onload="this.media='all'">/,
    )
    assert.match(home, /<noscript><link rel="stylesheet" href="\/_next\/site.css"><\/noscript>/)
    // The shared stylesheet stays whole for the other pages.
    assert.match(readFileSync(join(out, 'de/index.html'), 'utf8'), /\.unused\{color:blue\}/)
    assert.equal(
      readFileSync(join(out, '_next/site.css'), 'utf8'),
      '.used{color:red}.unused{color:blue}',
    )
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

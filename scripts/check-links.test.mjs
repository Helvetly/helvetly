import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('check-links.mjs', import.meta.url))

function check(pages) {
  const out = mkdtempSync(join(tmpdir(), 'helvetly-links-'))
  try {
    for (const [file, html] of Object.entries(pages)) {
      mkdirSync(join(out, file, '..'), { recursive: true })
      writeFileSync(join(out, file), html)
    }
    return spawnSync(process.execPath, [script, out], { encoding: 'utf8' })
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

test('accepts links to pages, nested pages, fragments and external URLs', () => {
  const run = check({
    'index.html':
      '<a href="/pricing">p</a><a href="/help/qr-bill#steps">h</a><a href="#top">t</a>' +
      '<a href="https://app.helvetly.com/login">l</a><script>"/missing"</script><i id="top"></i>',
    'pricing.html': '<a href="/">home</a>',
    'help/qr-bill.html': '<h2 id="steps">Steps</h2>',
  })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /4 internal links, none broken/)
})

test('fails on a missing page or a missing fragment', () => {
  const run = check({
    'index.html': '<a href="/gone">g</a><a href="/pricing#nope">n</a>',
    'pricing.html': '<h1 id="top">Pricing</h1>',
  })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /index.html → \/gone \(missing page\)/)
  assert.match(run.stderr, /index.html → \/pricing#nope \(missing #nope\)/)
})

test('keeps the pages of a prefixed language on that language', () => {
  const run = check({
    'index.html': '<a href="/de">de</a>',
    'de.html':
      '<a href="/de/pricing">p</a><a href="/de/">home</a><a href="/icon.svg">i</a><a href="/">en</a>',
    'de/pricing.html': '<a href="/pricing">en</a>',
    'pricing.html': '',
    'icon.svg': '',
  })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /de\/pricing.html → \/pricing \(leaves \/de\)/)
  assert.match(run.stderr, /de.html → \/ \(leaves \/de\)/)
  assert.equal(run.stderr.match(/leaves/g)?.length, 2)
})

test('fails when the export directory does not exist', () => {
  const run = spawnSync(process.execPath, [script, join(tmpdir(), 'helvetly-no-such-out')])
  assert.equal(run.status, 1)
})

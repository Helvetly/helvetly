import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { moveLanguageHomes } from './language-homes.mjs'

test('serves a language home page from its folder', () => {
  const out = mkdtempSync(join(tmpdir(), 'helvetly-homes-'))
  try {
    mkdirSync(join(out, 'de'))
    writeFileSync(join(out, 'de.html'), 'Startseite')
    writeFileSync(join(out, 'index.html'), 'Home')
    moveLanguageHomes(out, ['de'])
    assert.equal(readFileSync(join(out, 'de/index.html'), 'utf8'), 'Startseite')
    assert.equal(existsSync(join(out, 'de.html')), false)
    assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), 'Home')
    assert.throws(() => moveLanguageHomes(out, ['de']), /de\.html not found/)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildLocales } from './build-locales.mjs'

test('combines independent exports and preserves each language bundle', () => {
  const parent = join(tmpdir(), 'helvetly')
  mkdirSync(parent, { recursive: true })
  const cwd = mkdtempSync(join(parent, 'locale-test-'))
  const built = []
  try {
    buildLocales({
      cwd,
      config: { defaultLocale: 'en', locales: { en: {}, de: {} } },
      build(language) {
        built.push(language)
        const output = join(cwd, 'out')
        rmSync(output, { recursive: true, force: true })
        mkdirSync(join(output, '_next'), { recursive: true })
        writeFileSync(join(output, 'index.html'), `<html lang="${language}">`)
        writeFileSync(join(output, '_next', 'bundle.js'), language)
      },
    })
    assert.deepEqual(built, ['de', 'en'])
    assert.equal(readFileSync(join(cwd, 'out/index.html'), 'utf8'), '<html lang="en">')
    assert.equal(readFileSync(join(cwd, 'out/de/index.html'), 'utf8'), '<html lang="de">')
    assert.equal(readFileSync(join(cwd, 'out/_next/bundle.js'), 'utf8'), 'en')
    assert.equal(readFileSync(join(cwd, 'out/de/_next/bundle.js'), 'utf8'), 'de')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('rejects invalid locales before starting a build and propagates build failures', () => {
  let calls = 0
  assert.throws(
    () =>
      buildLocales({
        config: { defaultLocale: '../escape', locales: { '../escape': {} } },
        build() {
          calls++
        },
      }),
    /Invalid locale/,
  )
  assert.equal(calls, 0)
  assert.throws(
    () =>
      buildLocales({
        build() {
          throw new Error('Compilation failed')
        },
      }),
    /Compilation failed/,
  )
})

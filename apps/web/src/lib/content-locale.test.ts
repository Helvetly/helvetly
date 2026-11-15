import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { localizedContentFile } from './content-locale'

it('uses a translated article when present and English for missing translations', () => {
  const parent = join(tmpdir(), 'helvetly')
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(join(parent, 'content-locale-'))
  try {
    mkdirSync(join(directory, 'de'))
    writeFileSync(join(directory, 'article.md'), 'English')
    writeFileSync(join(directory, 'de/article.md'), 'Deutsch')
    expect(localizedContentFile(directory, 'article.md', 'de')).toBe(
      join(directory, 'de/article.md'),
    )
    expect(localizedContentFile(directory, 'article.md', 'pl')).toBe(join(directory, 'article.md'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

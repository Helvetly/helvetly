import { describe, expect, it } from 'vitest'

import { DEFAULT_VIEW } from '@/lib/documents'

import { parseTabs, tabOfView } from './pinned-tabs'

describe('parseTabs', () => {
  it.each([
    ['null', null, []],
    ['broken JSON', '{', []],
    ['not a list', '{"type":"trash"}', []],
    [
      'drops unknown, malformed, repeated and folder tabs',
      '[{"type":"trash"},{"type":"trash"},{"type":"folder"},{"type":"kind","kind":"exe"},{"type":"folder","id":"f1"},{"type":"x"}]',
      [{ type: 'trash' }],
    ],
    ['keeps a kind', '[{"type":"kind","kind":"pdf"}]', [{ type: 'kind', kind: 'pdf' }]],
  ])('%s', (_, raw, expected) => {
    expect(parseTabs(raw)).toEqual(expected)
  })
})

describe('tabOfView', () => {
  it.each([
    ['top level', {}, null],
    ['a folder', { folder: 'f1' }, null],
    ['a kind inside a folder', { folder: 'f1', kinds: ['pdf' as const] }, null],
    ['one kind', { kinds: ['pdf' as const] }, { type: 'kind', kind: 'pdf' }],
    ['two kinds', { kinds: ['pdf' as const, 'image' as const] }, null],
    ['recent', { section: 'recent' as const }, { type: 'recent' }],
    ['trash', { section: 'trash' as const }, { type: 'trash' }],
  ])('%s', (_, change, expected) => {
    expect(tabOfView({ ...DEFAULT_VIEW, ...change })).toEqual(expected)
  })
})

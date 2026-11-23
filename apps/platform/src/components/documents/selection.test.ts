import { describe, expect, it } from 'vitest'

import type { Folder } from '@/lib/documents'

import {
  bandRect,
  canDrop,
  checkModifiers,
  clickSelect,
  EMPTY_SELECTION,
  fileKey,
  folderKey,
  intersects,
  moveFocus,
  splitKeys,
  type ItemKey,
} from './selection'

const order: ItemKey[] = [folderKey('f1'), fileKey('a'), fileKey('b'), fileKey('c'), fileKey('d')]
const plain = { shift: false, toggle: false }
const check = (shiftKey: boolean, metaKey = false) =>
  checkModifiers({ shiftKey, metaKey, ctrlKey: false })

describe('clickSelect', () => {
  it('selects one, toggles with ⌘ and extends with shift', () => {
    let s = clickSelect(EMPTY_SELECTION, fileKey('a'), order, plain)
    expect([...s.keys]).toEqual([fileKey('a')])
    s = clickSelect(s, fileKey('c'), order, { shift: true, toggle: false })
    expect([...s.keys]).toEqual([fileKey('a'), fileKey('b'), fileKey('c')])
    s = clickSelect(s, fileKey('b'), order, { shift: false, toggle: true })
    expect([...s.keys]).toEqual([fileKey('a'), fileKey('c')])
    expect(s.anchor).toBe(fileKey('b'))
    // ⌘⇧ adds a range to what is selected; shift alone replaces it.
    s = clickSelect(s, folderKey('f1'), order, { shift: true, toggle: true })
    expect(new Set(s.keys)).toEqual(
      new Set([fileKey('a'), fileKey('b'), fileKey('c'), folderKey('f1')]),
    )
    s = clickSelect(s, fileKey('d'), order, { shift: true, toggle: false })
    expect([...s.keys]).toEqual([fileKey('b'), fileKey('c'), fileKey('d')])
  })

  it('extends and shrinks a checkbox range across folders and files', () => {
    let s = clickSelect(EMPTY_SELECTION, folderKey('f1'), order, check(false))
    s = clickSelect(s, fileKey('c'), order, check(true))
    expect([...s.keys]).toEqual([folderKey('f1'), fileKey('a'), fileKey('b'), fileKey('c')])
    s = clickSelect(s, fileKey('a'), order, check(true))
    expect([...s.keys]).toEqual([folderKey('f1'), fileKey('a')])
    // A plain or ⌘ checkbox click toggles one item and keeps the rest.
    s = clickSelect(s, fileKey('d'), order, check(false, true))
    expect([...s.keys]).toEqual([folderKey('f1'), fileKey('a'), fileKey('d')])
    s = clickSelect(s, fileKey('a'), order, check(false))
    expect([...s.keys]).toEqual([folderKey('f1'), fileKey('d')])
  })

  it('treats shift without an anchor as a plain click', () => {
    const s = clickSelect(EMPTY_SELECTION, fileKey('b'), order, { shift: true, toggle: false })
    expect([...s.keys]).toEqual([fileKey('b')])
  })

  it('splits keys into folder and file ids', () => {
    expect(splitKeys([folderKey('x'), fileKey('y')])).toEqual({ folders: ['x'], files: ['y'] })
  })
})

describe('moveFocus', () => {
  it.each([
    [0, 'ArrowRight', 4, 1],
    [1, 'ArrowDown', 4, 5],
    [5, 'ArrowDown', 4, 9],
    [9, 'ArrowDown', 4, 9],
    [2, 'ArrowUp', 4, 0],
    [3, 'Home', 4, 0],
    [3, 'End', 4, 9],
    [-1, 'ArrowDown', 1, 0],
  ] as const)('from %i with %s in %i columns goes to %i', (from, key, columns, want) => {
    expect(moveFocus(from, 10, key, columns)).toBe(want)
  })
})

describe('the rubber band', () => {
  it('normalises the corners and hits overlapping cards only', () => {
    const band = bandRect(100, 100, 20, 30)
    expect(band).toEqual({ left: 20, top: 30, right: 100, bottom: 100 })
    expect(intersects(band, { left: 90, top: 90, right: 150, bottom: 150 })).toBe(true)
    expect(intersects(band, { left: 100, top: 0, right: 150, bottom: 50 })).toBe(false)
  })
})

const folder = (id: string, parent: string | null): Folder => ({
  id,
  name: id,
  parent_id: parent,
  file_count: 0,
  size: 0,
  total_files: 0,
  total_size: 0,
  starred: false,
  created_by: null,
  created_at: '',
  updated_at: '',
})

describe('canDrop', () => {
  const folders = [folder('a', null), folder('b', 'a'), folder('c', null)]
  it.each([
    ['a folder into itself', { files: [], folders: ['a'], from: null }, 'a', false],
    ['a folder below itself', { files: [], folders: ['a'], from: null }, 'b', false],
    ['a folder where it is', { files: [], folders: ['b'], from: 'a' }, 'a', false],
    ['a folder elsewhere', { files: [], folders: ['b'], from: 'a' }, 'c', true],
    ['a folder to the top', { files: [], folders: ['b'], from: 'a' }, null, true],
    ['files where they are', { files: ['x'], folders: [], from: 'c' }, 'c', false],
    ['files from search results', { files: ['x'], folders: [], from: '*' }, 'c', true],
    ['files and a folder', { files: ['x'], folders: ['c'], from: null }, 'a', true],
    ['nothing', { files: [], folders: [], from: null }, 'a', false],
  ])('%s', (_, payload, target, want) => {
    expect(canDrop(folders, payload, target)).toBe(want)
  })
})

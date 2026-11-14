import { describe, expect, test } from 'vitest'

import { ariaKeyShortcuts, createMatcher, isTypingTarget, keyLabels } from './shortcuts'

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})

describe('createMatcher', () => {
  test.each([
    ['mod+j', key('j', { metaKey: true }), true],
    ['mod+j', key('j', { ctrlKey: true }), true],
    ['mod+j', key('J', { metaKey: true }), true],
    ['mod+j', key('j'), false],
    ['mod+j', key('j', { metaKey: true, altKey: true }), false],
    ['d', key('d'), true],
    ['d', key('d', { metaKey: true }), false],
    ['d', key('D', { shiftKey: true }), false],
    ['shift+d', key('D', { shiftKey: true }), true],
    ['?', key('?', { shiftKey: true }), true],
    ['/', key('/'), true],
    ['/', key('/', { ctrlKey: true }), false],
  ])('%s against %o is %s', (keys, event, expected) => {
    expect(createMatcher([keys])(event)).toBe(expected)
  })

  test('a keydown without a key (autofill) never matches', () => {
    expect(createMatcher(['d'])({ ...key('d'), key: undefined as unknown as string })).toBe(false)
  })

  test('any alternative matches', () => {
    const match = createMatcher(['/', 'mod+k'])
    expect(match(key('/'))).toBe(true)
    expect(match(key('k', { metaKey: true }))).toBe(true)
    expect(match(key('k'))).toBe(false)
  })

  test('a sequence completes on its last key within the timeout', () => {
    const match = createMatcher(['g n'], 1000)
    expect(match(key('g'), 0)).toBe(false)
    expect(match(key('n'), 500)).toBe(true)
    expect(match(key('n'), 600)).toBe(false)
  })

  test('a sequence lapses after the timeout and after another key', () => {
    const match = createMatcher(['g n'], 1000)
    match(key('g'), 0)
    expect(match(key('n'), 1500)).toBe(false)
    match(key('g'), 2000)
    match(key('x'), 2100)
    expect(match(key('n'), 2200)).toBe(false)
  })

  test('a repeated first key restarts the sequence, and modifiers alone do not break it', () => {
    const match = createMatcher(['g n'], 1000)
    match(key('g'), 0)
    match(key('g'), 100)
    match(key('Shift', { shiftKey: true }), 150)
    expect(match(key('n'), 200)).toBe(true)
  })
})

// jsdom has no isContentEditable; the stories cover contenteditable in a browser.
test('isTypingTarget: text fields, not buttons', () => {
  expect(isTypingTarget(document.createElement('input'))).toBe(true)
  expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
  expect(isTypingTarget(document.createElement('select'))).toBe(true)
  expect(isTypingTarget(document.createElement('button'))).toBe(false)
  expect(isTypingTarget(null)).toBe(false)
})

test('keyLabels: ⌘ on Apple devices, Ctrl elsewhere, a step per sequence key', () => {
  expect(keyLabels('mod+j', true)).toEqual([['⌘', 'J']])
  expect(keyLabels('mod+j', false)).toEqual([['Ctrl', 'J']])
  expect(keyLabels('shift+d', true)).toEqual([['⇧', 'D']])
  expect(keyLabels('g n', false)).toEqual([['G'], ['N']])
  expect(keyLabels('?', false)).toEqual([['?']])
})

test('ariaKeyShortcuts names single presses and leaves sequences out', () => {
  expect(ariaKeyShortcuts(['/', 'mod+k'], true)).toBe('/ Meta+K')
  expect(ariaKeyShortcuts(['mod+b'], false)).toBe('Control+B')
  expect(ariaKeyShortcuts(['g n'], false)).toBe('')
})

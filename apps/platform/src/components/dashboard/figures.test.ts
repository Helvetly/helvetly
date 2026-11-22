import { describe, expect, test } from 'vitest'

import { barHeights, change, firstName, greetingKey, share } from './figures'

describe('greetingKey', () => {
  test.each([
    [0, 'goodEveningName'],
    [4, 'goodEveningName'],
    [5, 'goodMorningName'],
    [11, 'goodMorningName'],
    [12, 'goodAfternoonName'],
    [17, 'goodAfternoonName'],
    [18, 'goodEveningName'],
    [23, 'goodEveningName'],
  ])('%i h → %s', (hour, key) => expect(greetingKey(hour)).toBe(key))
})

describe('firstName', () => {
  test.each([
    ['Anna Muster', 'Anna'],
    ['  Marco  ', 'Marco'],
    ['', ''],
    [undefined, ''],
    ['anna@example.ch', ''],
  ])('%s → %s', (name, first) => expect(firstName(name)).toBe(first))
})

describe('change', () => {
  test.each([
    ['120.00', '100.00', 0.2],
    ['50.00', '100.00', -0.5],
    ['100.00', '0.00', null],
    ['0.00', '100.00', null],
  ])('%s against %s → %s', (now, before, expected) => expect(change(now, before)).toBe(expected))
})

describe('share', () => {
  test.each([
    ['25.00', '100.00', 0.25],
    ['10.00', '0.00', 0],
    ['150.00', '100.00', 1],
  ])('%s of %s → %s', (part, whole, expected) => expect(share(part, whole)).toBe(expected))
})

describe('barHeights', () => {
  test('scales to the largest, keeps a stub for empty months and a floor for small ones', () => {
    expect(barHeights([0, 1, 100])).toEqual([0.08, 0.33, 1])
  })
  test('an all-empty series is all stubs', () => {
    expect(barHeights([0, 0])).toEqual([0.08, 0.08])
  })
})

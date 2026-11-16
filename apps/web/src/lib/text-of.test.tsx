import { describe, expect, it } from 'vitest'

import { textOf } from './text-of'

describe('textOf', () => {
  it.each([
    ['a string', 'Yes.', 'Yes.'],
    ['a number', 7, '7'],
    ['nothing', null, ''],
    [
      'nested elements',
      <>
        See the <strong>privacy policy</strong>.
      </>,
      'See the privacy policy.',
    ],
    ['a list', ['a', <b key="b">b</b>, false], 'ab'],
  ])('reads %s', (_, node, text) => {
    expect(textOf(node)).toBe(text)
  })
})

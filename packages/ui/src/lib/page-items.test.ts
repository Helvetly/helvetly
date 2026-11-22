import { describe, expect, it } from 'vitest'

import { pageItems } from './page-items'

describe('pageItems', () => {
  it.each([
    [1, 1, [1]],
    [3, 7, [1, 2, 3, 4, 5, 6, 7]],
    [1, 20, [1, 2, 3, 4, 5, 'gap-end', 20]],
    [4, 20, [1, 2, 3, 4, 5, 'gap-end', 20]],
    [5, 20, [1, 'gap-start', 4, 5, 6, 'gap-end', 20]],
    [16, 20, [1, 'gap-start', 15, 16, 17, 'gap-end', 20]],
    [17, 20, [1, 'gap-start', 16, 17, 18, 19, 20]],
    [20, 20, [1, 'gap-start', 16, 17, 18, 19, 20]],
    [1, 8, [1, 2, 3, 4, 5, 'gap-end', 8]],
  ])('page %i of %i', (page, pages, expected) => {
    expect(pageItems(page, pages)).toEqual(expected)
  })
})

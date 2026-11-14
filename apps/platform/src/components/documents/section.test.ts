import { describe, expect, it } from 'vitest'

import { parseCollapsed } from './section'

describe('parseCollapsed', () => {
  it.each([
    [null, []],
    ['["folders","recent"]', ['folders', 'recent']],
    ['["files","nope",3,"files"]', ['files']],
    ['{"folders":true}', []],
    ['not json', []],
  ])('%s → %j', (raw, ids) => {
    expect([...parseCollapsed(raw)]).toEqual(ids)
  })
})

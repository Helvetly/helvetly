import { describe, expect, it } from 'vitest'

import { Ridge } from './ridge'

describe('Ridge', () => {
  it('draws three layers that span the full width', () => {
    const svg = Ridge({ edge: 'rise' })
    const paths = (svg.props.children as { props: { d: string } }[]).map((p) => p.props.d)
    expect(paths).toHaveLength(3)
    for (const d of paths) {
      expect(d.startsWith('M0 160V')).toBe(true)
      expect(d).toMatch(/L1600 \d+V160Z$/)
    }
  })
})

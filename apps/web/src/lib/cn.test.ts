import { describe, expect, it } from 'vitest'

import { cn } from './cn'

describe('cn', () => {
  it('keeps a type token beside a colour', () => {
    expect(cn('text-body-sm text-muted-foreground')).toBe('text-body-sm text-muted-foreground')
    expect(cn('text-site', 'text-lead')).toBe('text-site text-lead')
  })
  it('still lets a later size replace an earlier one', () => {
    expect(cn('text-body', 'text-body-sm')).toBe('text-body-sm')
  })
})

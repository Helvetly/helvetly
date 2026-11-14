import { expect, test } from 'vitest'

import { cn } from './utils'

test('cn keeps a type-scale size next to a text colour', () => {
  expect(cn('text-body-sm', 'text-muted-foreground')).toBe('text-body-sm text-muted-foreground')
  expect(cn('text-body font-medium', 'text-destructive')).toBe(
    'text-body font-medium text-destructive',
  )
})

test('cn still lets a later size or colour win', () => {
  expect(cn('text-body-sm', 'text-title')).toBe('text-title')
  expect(cn('text-caption text-muted-foreground', 'text-foreground')).toBe(
    'text-caption text-foreground',
  )
  expect(cn('text-sm', 'text-body')).toBe('text-body')
})

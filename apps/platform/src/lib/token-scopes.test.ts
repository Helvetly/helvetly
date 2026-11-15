import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  accessByResource,
  emptyMatrix,
  isTokenScope,
  matrixScopes,
  scopeBadges,
  scopeSummary,
  TOKEN_RESOURCES,
} from './token-scopes'

type Spec = {
  paths: Record<string, Record<string, { tags?: string[]; 'x-helvetly-write'?: boolean }>>
}

describe('TOKEN_RESOURCES', () => {
  it('lists every tag of the public catalogue, writable where an operation writes', () => {
    // Relative to this file: the working directory is the repo root under test:coverage.
    const path = resolve(import.meta.dirname, '../../../api/internal/openapi/openapi.json')
    const spec: Spec = JSON.parse(readFileSync(path, 'utf8'))
    const catalogue = new Map<string, boolean>()
    for (const operations of Object.values(spec.paths))
      for (const operation of Object.values(operations)) {
        const tag = operation.tags?.[0]?.toLowerCase()
        if (tag)
          catalogue.set(tag, (catalogue.get(tag) ?? false) || !!operation['x-helvetly-write'])
      }
    expect(
      Object.fromEntries(TOKEN_RESOURCES.map(({ name, writable }) => [name, writable])),
    ).toEqual(Object.fromEntries(catalogue))
  })

  it('offers no HR resource: employees and payroll stay out of the public API', () => {
    const hr = ['employees', 'payroll', 'employee-documents', 'payroll-approval', 'payroll-export']
    expect(TOKEN_RESOURCES.filter(({ name }) => hr.includes(name))).toEqual([])
  })
})

describe('scopes', () => {
  it.each([
    ['read:*', true],
    ['write:invoices', true],
    ['read:members', false],
    ['delete:*', false],
    ['read', false],
  ])('isTokenScope(%s) is %s', (value, expected) => {
    expect(isTokenScope(value)).toBe(expected)
  })

  it('turns a matrix into scopes, writes without their implied read', () => {
    expect(matrixScopes(emptyMatrix())).toEqual([])
    expect(
      matrixScopes({ ...emptyMatrix(), clients: 'read', invoices: 'write', reports: 'read' }),
    ).toEqual(['read:clients', 'write:invoices', 'read:reports'])
  })

  it('reads access per resource: write implies read, wildcards cover all', () => {
    expect(accessByResource(['read:*', 'write:invoices'])).toMatchObject({
      clients: 'read',
      invoices: 'write',
      reports: 'read',
    })
    expect(accessByResource(['write:*'])).toMatchObject({
      clients: 'write',
      expenses: 'write',
      reports: 'read',
    })
    expect(accessByResource(['write:clients'])).toMatchObject({
      clients: 'write',
      invoices: 'none',
    })
  })

  it.each([
    [['read:*'], ['Read everything']],
    [['read:*', 'write:*'], ['Full access']],
    [
      ['read:*', 'write:clients'],
      ['Read everything', 'Clients · write'],
    ],
    [
      ['read:expenses', 'read:invoices', 'write:invoices'],
      ['Invoices and payments · write', 'Expenses · read'],
    ],
  ])('badges for %j', (scopes, labels) => {
    expect(scopeBadges(scopes).map((badge) => badge.label)).toEqual(labels)
  })

  it('summarises what a token reads and writes', () => {
    expect(scopeSummary(['read:clients', 'write:invoices'])).toEqual({
      reads: ['Clients', 'Invoices and payments'],
      writes: ['Invoices and payments'],
      readsAll: false,
      writesAll: false,
    })
    expect(scopeSummary(['read:*', 'write:*'])).toMatchObject({ readsAll: true, writesAll: true })
  })
})

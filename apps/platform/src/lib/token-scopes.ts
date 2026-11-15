import { translate } from '@/lib/i18n'
/**
 * API token scopes (docs/api-tokens-contract.md): "read:<resource>" or "write:<resource>", "*" for every
 * resource; write implies read. The resources are the public catalogue's tags (openapi.json), in the
 * order the drawer lists them; `writable` marks those with operations that change something.
 */
export const TOKEN_RESOURCES = [
  { name: 'clients', label: translate('clients'), writable: true },
  { name: 'invoices', label: translate('invoicesAndPayments'), writable: true },
  { name: 'quotes', label: translate('quotes'), writable: true },
  { name: 'instalments', label: translate('instalmentPlans'), writable: true },
  { name: 'expenses', label: translate('expenses'), writable: true },
  { name: 'documents', label: translate('documents'), writable: true },
  { name: 'engagements', label: translate('engagements'), writable: true },
  { name: 'products', label: translate('productsAndServices'), writable: true },
  { name: 'books', label: translate('booksVATAndLedger'), writable: true },
  { name: 'reports', label: translate('reportsKeyFigures'), writable: false },
] as const

export type TokenResource = (typeof TOKEN_RESOURCES)[number]['name']
export type TokenScope = `${'read' | 'write'}:${TokenResource | '*'}`
export const isTokenScope = (value: string): value is TokenScope => {
  const [action, resource] = value.split(':')
  return (
    (action === 'read' || action === 'write') &&
    (resource === '*' || TOKEN_RESOURCES.some(({ name }) => name === resource))
  )
}
export type Access = 'none' | 'read' | 'write'
/** Custom access per resource. */
export type ScopeMatrix = Record<TokenResource, Access>

export const PRESETS = [
  { value: 'read', label: translate('readEverything'), scopes: ['read:*'] },
  { value: 'full', label: translate('fullAccess'), scopes: ['read:*', 'write:*'] },
  { value: 'custom', label: translate('custom'), scopes: [] },
] as const satisfies readonly { value: string; label: string; scopes: readonly TokenScope[] }[]
export type Preset = (typeof PRESETS)[number]['value']

export const emptyMatrix = (): ScopeMatrix => ({
  clients: 'none',
  invoices: 'none',
  quotes: 'none',
  instalments: 'none',
  expenses: 'none',
  documents: 'none',
  engagements: 'none',
  products: 'none',
  books: 'none',
  reports: 'none',
})

/** The scopes a matrix stands for (the API adds each write's read). */
export function matrixScopes(matrix: ScopeMatrix): TokenScope[] {
  return TOKEN_RESOURCES.flatMap(({ name }): TokenScope[] =>
    matrix[name] === 'write' ? [`write:${name}`] : matrix[name] === 'read' ? [`read:${name}`] : [],
  )
}

/** What scopes allow on each resource. */
export function accessByResource(scopes: readonly string[]): ScopeMatrix {
  const matrix = emptyMatrix()
  const has = (action: 'read' | 'write', name: string) =>
    scopes.includes(`${action}:${name}`) || scopes.includes(`${action}:*`)
  for (const { name, writable } of TOKEN_RESOURCES) {
    if (writable && has('write', name)) matrix[name] = 'write'
    else if (has('read', name) || has('write', name)) matrix[name] = 'read'
  }
  return matrix
}

export type ScopeBadge = { label: string; tone: 'gray' | 'amber' }

/**
 * Compact labels for a token's scopes: "Full access" or "Read everything" for the presets, else one per
 * resource ("Invoices and payments · write"), with "Read everything" first when a wildcard read is
 * combined with some writes.
 */
export function scopeBadges(scopes: readonly string[]): ScopeBadge[] {
  const readAll = scopes.includes('read:*') || scopes.includes('write:*')
  if (scopes.includes('write:*')) return [{ label: translate('fullAccess'), tone: 'amber' }]
  const badges: ScopeBadge[] = readAll ? [{ label: translate('readEverything'), tone: 'gray' }] : []
  for (const { name, label } of TOKEN_RESOURCES) {
    if (scopes.includes(`write:${name}`))
      badges.push({ label: translate('write4', { label: label }), tone: 'amber' })
    else if (!readAll && scopes.includes(`read:${name}`))
      badges.push({ label: translate('read5', { label: label }), tone: 'gray' })
  }
  return badges
}

/** The resources a token can read and change, as labels, for the drawer's summary. */
export function scopeSummary(scopes: readonly string[]) {
  const access = accessByResource(scopes)
  const labels = (level: Access[]) =>
    TOKEN_RESOURCES.filter(({ name }) => level.includes(access[name])).map(({ label }) => label)
  return {
    reads: labels(['read', 'write']),
    writes: labels(['write']),
    /** Every resource, also those added later. */
    readsAll: scopes.includes('read:*') || scopes.includes('write:*'),
    writesAll: scopes.includes('write:*'),
  }
}

'use client'
// What a member may see and change, mirroring "Permission scopes" in docs/members-contract.md.
// Owners and admins always have `*:*`; the Go API enforces, this only hides what would be refused.
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

export type Action = 'read' | 'write'

export const RESOURCES = [
  {
    id: 'clients',
    label: translate('clients'),
    description: translate('clientRecordsContactsAndFiles'),
  },
  {
    id: 'invoices',
    label: translate('invoices'),
    description: translate('invoicesQuotesCreditNotesAndPayments'),
  },
  { id: 'expenses', label: translate('expenses'), description: translate('expensesAndReceipts') },
  { id: 'products', label: translate('productsServices'), description: translate('thePriceList') },
  {
    id: 'documents',
    label: translate('documents'),
    description: translate('filesTemplatesAndSignatures'),
  },
  {
    id: 'engagements',
    label: translate('engagements'),
    description: translate('retainersLoggedHoursAndReports'),
  },
  {
    id: 'members',
    label: translate('members'),
    description: translate('theTeamAndInvitations'),
    viewOnly: true,
  },
  {
    id: 'settings',
    label: translate('settings'),
    description: translate('invoiceWorkspaceAndEngagementSettings'),
    viewOnly: true,
  },
  {
    id: 'billing',
    label: translate('billing'),
    description: translate('planUsageAndInvoicesFromHelvetly'),
    viewOnly: true,
  },
] as const

export type Resource = (typeof RESOURCES)[number]['id']
export type Need = `${Action}:${Resource}`

/** Owners and admins, and a session from an API that does not send scopes yet. */
export const EVERYTHING = ['*:*']

/** True when one of the scopes grants `need`: `*` matches any part, and write implies read. */
export function can(scopes: readonly string[], need: Need): boolean {
  const [action, resource] = need.split(':')
  return scopes.some((scope) => {
    const [scopeAction, scopeResource] = scope.split(':')
    return (
      (scopeResource === '*' || scopeResource === resource) &&
      (scopeAction === '*' ||
        scopeAction === action ||
        (scopeAction === 'write' && action === 'read'))
    )
  })
}

export type Level = 'none' | 'view' | 'edit'
export type Levels = Record<Resource, Level>

/** Members, settings and billing are managed by role, so a scope never reaches past "view". */
export function levelsOf(scopes: readonly string[]): Levels {
  const levels: Levels = {
    clients: 'none',
    invoices: 'none',
    expenses: 'none',
    products: 'none',
    documents: 'none',
    engagements: 'none',
    members: 'none',
    settings: 'none',
    billing: 'none',
  }
  for (const resource of RESOURCES) {
    if (can(scopes, `write:${resource.id}`))
      levels[resource.id] = 'viewOnly' in resource ? 'view' : 'edit'
    else if (can(scopes, `read:${resource.id}`)) levels[resource.id] = 'view'
  }
  return levels
}

export type PresetId = 'full' | 'read' | 'accountant' | 'custom'

export const PRESETS: { id: PresetId; label: string; scopes: string[] | null }[] = [
  { id: 'full', label: translate('fullAccess'), scopes: ['*:*'] },
  { id: 'read', label: translate('readOnly2'), scopes: ['read:*'] },
  {
    id: 'accountant',
    label: translate('accountant'),
    scopes: ['read:*', 'write:invoices', 'write:expenses'],
  },
  { id: 'custom', label: translate('custom'), scopes: null },
]

const sameLevels = (a: Levels, b: Levels) => RESOURCES.every(({ id }) => a[id] === b[id])

/** The preset whose effect equals these scopes, else custom. `null` (owner, admin) is full. */
export function presetOf(scopes: readonly string[] | null): PresetId {
  if (!scopes) return 'full'
  const levels = levelsOf(scopes)
  const match = PRESETS.find(
    (preset) => preset.scopes && sameLevels(levelsOf(preset.scopes), levels),
  )
  return match?.id ?? 'custom'
}

/** The scope list for a matrix of levels: a preset's own list when it matches, else one per row. */
export function scopesFor(levels: Levels): string[] {
  const match = PRESETS.find(
    (preset) => preset.scopes && sameLevels(levelsOf(preset.scopes), levels),
  )
  if (match?.scopes) return match.scopes
  return RESOURCES.flatMap(({ id }) =>
    levels[id] === 'none' ? [] : [`${levels[id] === 'edit' ? 'write' : 'read'}:${id}`],
  )
}

const name = (resource: { label: string }) => resource.label.toLowerCase()

const list = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** One line for the access summary: "Can view everything, edit invoices and expenses". */
export function describeAccess(scopes: readonly string[] | null): string {
  const levels = levelsOf(scopes ?? EVERYTHING)
  const viewable = RESOURCES.filter(({ id }) => levels[id] !== 'none')
  const editable = RESOURCES.filter(({ id }) => levels[id] === 'edit')
  if (viewable.length === 0) return translate('noAccess')
  const everythingEditable = RESOURCES.filter((resource) => !('viewOnly' in resource))
  const all = viewable.length === RESOURCES.length
  if (all && editable.length === everythingEditable.length)
    return translate('canViewAndEditEverything')
  const view = all ? 'everything' : list(viewable.map(name))
  return editable.length === 0
    ? translate('canView', { view: view })
    : translate('canViewEdit', { view: view, value2: list(editable.map(name)) })
}

const ROUTES: [string, Resource][] = [
  ['/clients', 'clients'],
  ['/invoices', 'invoices'],
  ['/quotes', 'invoices'],
  ['/products', 'products'],
  ['/expenses', 'expenses'],
  ['/engagements', 'engagements'],
  ['/documents', 'documents'],
  ['/members', 'members'],
  ['/settings/invoices', 'settings'],
  ['/settings/workspace', 'settings'],
  ['/settings/billing', 'billing'],
]

/** The resource a page shows; none for the dashboard, security and the like. */
export function resourceForPath(pathname: string): Resource | null {
  return ROUTES.find(([base]) => pathname === base || pathname.startsWith(`${base}/`))?.[1] ?? null
}

export const labelOf = (resource: Resource) =>
  RESOURCES.find(({ id }) => id === resource)?.label ?? resource

/** The signed-in person's scopes; a session without any (API not updated yet) means everything. */
export function useScopes(): readonly string[] {
  return useSession().data?.scopes ?? EVERYTHING
}

export function useCan(need: Need): boolean {
  return can(useScopes(), need)
}

/** Whether the current page's resource may be changed; true on pages without one. */
export function useCanWriteHere(): boolean {
  const scopes = useScopes()
  const resource = resourceForPath(usePathname() ?? '')
  return !resource || can(scopes, `write:${resource}`)
}

/** The scope a 403 names in `details.scope`, e.g. `write:invoices`. */
export function refusedScope(error: unknown): string | null {
  const scope = error instanceof ApiError && error.status === 403 ? error.details.scope : null
  return typeof scope === 'string' ? scope : null
}

/** What the person tried: "write:invoices" is "change invoices". */
function attempt(scope: string): string {
  const [action, resource] = scope.split(':')
  const noun = RESOURCES.find(({ id }) => id === resource)?.label.toLowerCase() ?? 'this'
  return `${action === 'read' ? 'view' : 'change'} ${noun}`
}

/** A toast for a 403 that names a missing scope; reports whether it was one. */
export function toastForbidden(error: unknown): boolean {
  const scope = refusedScope(error)
  if (!scope) return false
  // One toast per scope, however many requests were refused at once.
  toast.error(translate('youDonTHavePermissionTo', { value1: attempt(scope) }), { id: scope })
  return true
}

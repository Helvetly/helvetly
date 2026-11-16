'use client'

// What a member may see and change, mirroring "Permission scopes" in docs/members-contract.md and
// permissions.Allows in apps/api/internal/permissions. The Go API enforces, this only hides what would be refused.
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
  // HR: a "*" resource never reaches these; owners hold both, admins ADMIN_HR until the owner sets their own list.
  {
    id: 'employees',
    label: translate('accessEmployees'),
    description: translate('accessEmployeesDescription'),
    hr: true,
  },
  {
    id: 'payroll',
    label: translate('accessPayroll'),
    description: translate('accessPayrollDescription'),
    hr: true,
  },
] as const

export type Resource = (typeof RESOURCES)[number]['id']
export type Need = `${Action}:${Resource}`

/** Owners and admins, and a session from an API that does not send scopes yet. */
export const EVERYTHING = ['*:*']

export const HR_RESOURCES: readonly Resource[] = RESOURCES.flatMap((resource) =>
  'hr' in resource ? [resource.id] : [],
)
const isHR = (resource: string | undefined) => HR_RESOURCES.some((id) => id === resource)
/** The HR part of a scope list, which presets and "*" never carry. */
export const hrScopes = (scopes: readonly string[]) =>
  scopes.filter((scope) => isHR(scope.split(':')[1]))

/** What an admin holds of HR until the owner sets their own list: the Accountant level (permissions.AdminHR). */
export const ADMIN_HR = ['read:payroll']

/** The HR scopes a membership holds, as permissions.EffectiveHR: both at Edit for an owner, an admin's own list or
 * ADMIN_HR while it is unset (null), a member's HR scopes. */
export function effectiveHR(
  role: string | undefined,
  scopes: readonly string[] | null | undefined,
) {
  if (role === 'owner') return HR_RESOURCES.map((id) => `write:${id}`)
  if (role === 'admin') return hrScopes(scopes ?? ADMIN_HR)
  return hrScopes(scopes ?? [])
}

/**
 * A membership's scopes as `can` reads them: owners and admins `*:*` (which never reaches HR) plus their
 * `effectiveHR`, a member their own list. So `can(effectiveScopes(role, scopes), need)` is
 * permissions.Allows(role, scopes, need).
 */
export function effectiveScopes(
  role: string | undefined,
  scopes: readonly string[] | null | undefined,
): readonly string[] {
  if (role === 'owner' || role === 'admin') return [...EVERYTHING, ...effectiveHR(role, scopes)]
  return scopes ?? EVERYTHING
}

/**
 * True when one of the scopes grants `need`: `*` matches any action and any resource but the HR ones,
 * and write implies read.
 */
export function can(scopes: readonly string[], need: Need): boolean {
  const [action, resource] = need.split(':')
  return scopes.some((scope) => {
    const [scopeAction, scopeResource] = scope.split(':')
    return (
      (scopeResource === resource || (scopeResource === '*' && !isHR(resource))) &&
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
    employees: 'none',
    payroll: 'none',
  }
  for (const resource of RESOURCES) {
    if (can(scopes, `write:${resource.id}`))
      levels[resource.id] = 'viewOnly' in resource ? 'view' : 'edit'
    else if (can(scopes, `read:${resource.id}`)) levels[resource.id] = 'view'
  }
  return levels
}

export type PresetId = 'full' | 'read' | 'accountant' | 'custom'

/** `scopes` the general areas, `hr` what an owner's pick of the preset sets on the HR rows. */
export const PRESETS: { id: PresetId; label: string; scopes: string[] | null; hr: string[] }[] = [
  { id: 'full', label: translate('fullAccess'), scopes: ['*:*'], hr: ADMIN_HR },
  { id: 'read', label: translate('readOnly2'), scopes: ['read:*'], hr: [] },
  {
    id: 'accountant',
    label: translate('accountant'),
    scopes: ['read:*', 'write:invoices', 'write:expenses'],
    hr: ADMIN_HR,
  },
  { id: 'custom', label: translate('custom'), scopes: null, hr: [] },
]

const GENERAL = RESOURCES.filter((resource) => !('hr' in resource))
const HR = RESOURCES.filter((resource) => 'hr' in resource)

// A preset is recognised by the general areas alone: picking one as a non-owner keeps the HR rows as they are (only an
// owner changes them), so counting HR would turn that pick into Custom at once. The HR rows are summarised apart.
const sameLevels = (a: Levels, b: Levels) => GENERAL.every(({ id }) => a[id] === b[id])

const rowScopes = (rows: readonly { id: Resource }[], levels: Levels) =>
  rows.flatMap(({ id }) =>
    levels[id] === 'none' ? [] : [`${levels[id] === 'edit' ? 'write' : 'read'}:${id}`],
  )

/** The preset whose effect on the general areas equals these scopes, else custom. `null` (owner, admin) is full. */
export function presetOf(scopes: readonly string[] | null): PresetId {
  if (!scopes) return 'full'
  const levels = levelsOf(scopes)
  const match = PRESETS.find(
    (preset) => preset.scopes && sameLevels(levelsOf(preset.scopes), levels),
  )
  return match?.id ?? 'custom'
}

/** The scope list for a matrix of levels: a preset's general list when it matches (else one per row), then the HR
 * rows as they are. */
export function scopesFor(levels: Levels): string[] {
  const match = PRESETS.find(
    (preset) => preset.scopes && sameLevels(levelsOf(preset.scopes), levels),
  )
  return [...(match?.scopes ?? rowScopes(GENERAL, levels)), ...rowScopes(HR, levels)]
}

const name = (resource: { label: string }) => resource.label.toLowerCase()

const list = (names: string[]) =>
  names.length < 2
    ? names.join('')
    : translate('dynamicAnd', { value1: names.slice(0, -1).join(', '), value2: names.at(-1) })

function describeGeneral(levels: Levels): string {
  const viewable = GENERAL.filter(({ id }) => levels[id] !== 'none')
  const editable = GENERAL.filter(({ id }) => levels[id] === 'edit')
  if (viewable.length === 0) return translate('noAccess')
  const everythingEditable = GENERAL.filter((resource) => !('viewOnly' in resource))
  const all = viewable.length === GENERAL.length
  if (all && editable.length === everythingEditable.length)
    return translate('canViewAndEditEverything')
  const view = all ? translate('accessEverything') : list(viewable.map(name))
  return editable.length === 0
    ? translate('canView', { view: view })
    : translate('canViewEdit', { view: view, value2: list(editable.map(name)) })
}

/** The HR rows in a few words: "view payroll", "edit employees and view payroll"; null without HR access. */
export function describeHR(scopes: readonly string[]): string | null {
  const levels = levelsOf(scopes)
  const hr = HR.filter(({ id }) => levels[id] !== 'none').map((resource) =>
    translate(levels[resource.id] === 'edit' ? 'accessEditArea' : 'accessViewArea', {
      area: name(resource),
    }),
  )
  return hr.length === 0 ? null : list(hr)
}

/** One line for the access summary: "Can view everything, edit invoices and expenses; HR: view payroll". */
export function describeAccess(scopes: readonly string[] | null): string {
  const general = describeGeneral(levelsOf(scopes ?? EVERYTHING))
  const hr = describeHR(scopes ?? [])
  return hr ? translate('accessWithHR', { general, hr }) : general
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
  ['/employees/payroll', 'payroll'],
  // The list also serves payroll, which picks employees by name: see `canReadPath`.
  ['/employees', 'employees'],
  ['/settings/invoices', 'settings'],
  ['/settings/workspace', 'settings'],
  ['/settings/employment', 'employees'],
  ['/settings/billing', 'billing'],
]

/** The resource a page shows; none for the dashboard, security and the like. */
export function resourceForPath(pathname: string): Resource | null {
  return ROUTES.find(([base]) => pathname === base || pathname.startsWith(`${base}/`))?.[1] ?? null
}

// Pages the API also serves with payroll view (GET /employees, GET /employment/settings).
const ALSO_PAYROLL = new Set(['/employees', '/settings/employment'])

/** Whether these scopes may open the page: read of its resource, or payroll view for the employee list and the
 * employment settings. */
export function canReadPath(scopes: readonly string[], pathname: string): boolean {
  const resource = resourceForPath(pathname)
  if (!resource || can(scopes, `read:${resource}`)) return true
  return ALSO_PAYROLL.has(pathname.replace(/\/$/, '')) && can(scopes, 'read:payroll')
}

export const labelOf = (resource: Resource) =>
  RESOURCES.find(({ id }) => id === resource)?.label ?? resource

/** The signed-in person's scopes as `can` reads them (`effectiveScopes`); none from the API means everything. */
export function useScopes(): readonly string[] {
  const session = useSession().data
  return effectiveScopes(session?.role, session?.scopes)
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

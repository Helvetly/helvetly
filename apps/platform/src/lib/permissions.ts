'use client'
// What a member may see and change, mirroring "Permission scopes" in docs/members-contract.md.
// Owners and admins have `*:*`, which never reaches the HR areas (permissions.Allows); the Go API enforces, this only
// hides what would be refused.
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
    id: 'scheduling',
    label: translate('schedScheduling'),
    description: translate('schedResourceDescription'),
  },
  {
    id: 'members',
    label: translate('members'),
    description: translate('theTeamAndInvitations'),
    viewOnly: translate('ownersAndAdminsManageThis'),
  },
  {
    id: 'invoice-settings',
    label: translate('invoiceSettings'),
    description: translate('sellerDetailsNumberingPaymentRemindersAndLogo'),
  },
  {
    id: 'vat-return',
    label: translate('vatReturn'),
    description: translate('theVatReturnAndItsMethod'),
  },
  {
    id: 'ledger',
    label: translate('ledger'),
    description: translate('theBooksTheirExportsAndTheChartOfAccounts'),
  },
  {
    id: 'periods',
    label: translate('periodClosing'),
    description: translate('closingAndReopeningMonths'),
  },
  {
    id: 'audit-log',
    label: translate('auditLog'),
    description: translate('theRecordOfFinancialEventsAndItsExport'),
    viewOnly: translate('theAuditLogCannotBeChanged'),
  },
  {
    id: 'workspace',
    label: translate('workspace'),
    description: translate('theWorkspaceSNameAndTimeZone'),
    viewOnly: translate('ownersAndAdminsManageThis'),
  },
  {
    id: 'billing',
    label: translate('billing'),
    description: translate('planUsageAndInvoicesFromHelvetly'),
    viewOnly: translate('ownersAndAdminsManageThis'),
  },
  {
    id: 'api',
    label: translate('apiMCP'),
    description: translate('personalApiTokensNeverBeyondTheirOwnAccess'),
    viewOnly: translate('viewLetsThemCreateAndUseTokens'),
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
/** The HR part of a scope list, which "*" never reaches. */
export const hrScopes = (scopes: readonly string[]) =>
  scopes.filter((scope) => isHR(scope.split(':')[1]))

/** What an admin holds of HR until the owner sets their own list: payroll view, an outside accountant's level
 * (permissions.AdminHR). */
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

/** Areas managed by role (or never changed) stop at "view", whatever the scope says. */
export function levelsOf(scopes: readonly string[]): Levels {
  const levels: Levels = {
    clients: 'none',
    invoices: 'none',
    expenses: 'none',
    products: 'none',
    documents: 'none',
    engagements: 'none',
    scheduling: 'none',
    members: 'none',
    'invoice-settings': 'none',
    'vat-return': 'none',
    ledger: 'none',
    periods: 'none',
    'audit-log': 'none',
    workspace: 'none',
    billing: 'none',
    api: 'none',
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

export type PresetId = 'read' | 'full' | 'custom'

/** `scopes` the general areas, `hr` what an owner's pick of the preset sets on the HR rows. */
export const PRESETS: {
  id: PresetId
  label: string
  description: string
  scopes: string[] | null
  hr: string[]
}[] = [
  {
    id: 'read',
    label: translate('readOnly2'),
    description: translate('canViewEverythingAndChangeNothing'),
    scopes: ['read:*'],
    hr: [],
  },
  {
    id: 'full',
    label: translate('fullAccess'),
    description: translate('canViewAndEditEverythingMembersWorkspaceAndBilling'),
    scopes: ['*:*'],
    hr: ADMIN_HR,
  },
  {
    id: 'custom',
    label: translate('custom'),
    description: translate('chooseWhatTheyCanViewAndEditInEachArea'),
    scopes: null,
    hr: [],
  },
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

/** The preset whose effect equals these scopes, else custom. `null` (owner, admin) is full. */
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

const list = (names: string[]) =>
  names.length < 2
    ? names.join('')
    : translate('dynamicAnd', { value1: names.slice(0, -1).join(', '), value2: names.at(-1) })

/** The HR rows in a few words: "view payroll", "edit employees and view payroll"; null without HR access. */
export function describeHR(scopes: readonly string[]): string | null {
  const levels = levelsOf(scopes)
  const hr = HR.filter(({ id }) => levels[id] !== 'none').map((resource) =>
    translate(levels[resource.id] === 'edit' ? 'accessEditArea' : 'accessViewArea', {
      area: resource.label.toLowerCase(),
    }),
  )
  return hr.length === 0 ? null : list(hr)
}

const ROUTES: [string, Resource][] = [
  ['/clients', 'clients'],
  ['/invoices', 'invoices'],
  ['/quotes', 'invoices'],
  ['/products', 'products'],
  ['/expenses', 'expenses'],
  ['/engagements', 'engagements'],
  ['/scheduling', 'scheduling'],
  ['/documents', 'documents'],
  // The books' tabs before the closing tab, whose address is their parent.
  ['/books/vat-return', 'vat-return'],
  ['/books/ledger', 'ledger'],
  ['/books', 'periods'],
  ['/members', 'members'],
  ['/settings/workspace', 'workspace'],
  ['/settings/emails', 'workspace'],
  ['/settings/api', 'api'],
  ['/settings/billing', 'billing'],
  ['/settings/company', 'invoice-settings'],
  ['/settings/invoices', 'invoice-settings'],
  // Your signature for contracts made from quotes: whoever reads quotes.
  ['/settings/documents', 'invoices'],
  // Owners and admins only: the settings tabs also check the role (members can hold `*:*`).
  ['/settings/approvals', 'workspace'],
  ['/settings/scheduling', 'scheduling'],
  ['/settings/audit-log', 'audit-log'],
  ['/employees/payroll', 'payroll'],
  // The list also serves payroll, which picks employees by name: see `canReadPath`.
  ['/employees', 'employees'],
  ['/settings/employment', 'employees'],
]

/** The resource a page shows; none for the dashboard, security and the like. */
export function resourceForPath(pathname: string): Resource | null {
  return ROUTES.find(([base]) => pathname === base || pathname.startsWith(`${base}/`))?.[1] ?? null
}

export const labelOf = (resource: Resource) =>
  RESOURCES.find(({ id }) => id === resource)?.label ?? resource

// Pages the API also serves with payroll view (GET /employees, GET /employment/settings).
const ALSO_PAYROLL = new Set(['/employees', '/settings/employment'])

/** Whether these scopes may open the page: read of its resource, or payroll view for the employee list and the
 * employment settings. */
export function canReadPath(scopes: readonly string[], pathname: string): boolean {
  const resource = resourceForPath(pathname)
  if (!resource || can(scopes, `read:${resource}`)) return true
  return ALSO_PAYROLL.has(pathname.replace(/\/$/, '')) && can(scopes, 'read:payroll')
}

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

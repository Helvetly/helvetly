import { formatPrice } from '@helvetly/ui/lib/price'
import {
  Banknote,
  BookOpenCheck,
  CalendarRange,
  Check,
  FileCode2,
  FilePen,
  FileSignature,
  FileText,
  type LucideIcon,
  Minus,
  QrCode,
  Receipt,
  Sparkles,
  UsersRound,
  Workflow,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { Cta } from '@/components/cta'
import { cn } from '@/lib/cn'
import { translate } from '@/lib/i18n'
import {
  BENEFITS,
  formatLimit,
  LIMITS,
  type Plan,
  type PlanId,
  PLANS,
  priceOf,
  RECOMMENDED,
  type Scope,
  USAGE_DETAILS,
} from '@/lib/plans'
import { START_URL } from '@/lib/site'
import { type Tone, TONES } from '@/lib/tones'

// The same colours as the pricing cards: Basic sky, Pro lilac (the recommended night card), Business mint.
const PLAN_TONE: Record<PlanId, Tone> = { basic: 'sky', pro: 'lilac', business: 'mint' }

const ICONS: Record<string, LucideIcon> = {
  invoicing: FileText,
  swiss_qr: QrCode,
  revolut: Banknote,
  engagements: CalendarRange,
  automations: Workflow,
  heidi: Sparkles,
  client_portal: UsersRound,
  expenses: Receipt,
  documents_signatures: FileSignature,
  corrections_vat: FilePen,
  einvoice_xml: FileCode2,
  ledger_exports: BookOpenCheck,
}

const SCOPE: Record<Scope, string> = {
  workspace: translate('perWorkspace'),
  person: translate('perPaidPerson'),
}

type Row = {
  key: string
  label: string
  /** Shown under the label everywhere. */
  hint?: string
  /** Shown under the label in the wide table only, where there is room. */
  note?: string
  icon?: LucideIcon
  cell: (plan: PlanId) => string | null
}

const BENEFIT_ROWS: Row[] = BENEFITS.map((b) => ({
  key: b.key,
  label: b.label,
  note: b.note,
  icon: ICONS[b.key],
  cell: b.cell,
}))

const LIMIT_ROWS: Row[] = USAGE_DETAILS.map((key) => ({
  key,
  label: LIMITS[key].label,
  hint: SCOPE[LIMITS[key].scope],
  cell: (plan) => formatLimit(key, plan),
}))

function Value({ text }: { text: string | null }) {
  if (text === null)
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap opacity-60">
        <Minus aria-hidden className="size-4 shrink-0" />
        {translate('notIncluded')}
      </span>
    )
  return (
    <span className="inline-flex items-start gap-1.5 font-medium tabular-nums">
      {text.startsWith('Included') && (
        <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
      )}
      {text}
    </span>
  )
}

function PlanHead({ plan }: { plan: Plan }) {
  const recommended = plan.id === RECOMMENDED
  return (
    <>
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn('size-2.5 rounded-full', TONES[PLAN_TONE[plan.id]].solid)}
        />
        <span className="text-title-sm font-semibold">{plan.name}</span>
        {recommended && (
          <span className="ml-auto rounded-full bg-linear-to-r from-heidi-from to-heidi-to px-2 py-0.5 text-caption font-medium text-white">
            {translate('recommended')}
          </span>
        )}
      </span>
      <span
        className={cn(
          'mt-1 block text-body-sm font-normal',
          recommended ? 'text-white/70' : 'text-muted-foreground',
        )}
      >
        {formatPrice(priceOf(plan, 'month'))}
        {translate('personMonth')}
      </span>
    </>
  )
}

/** One wide table: Pro's column is a lit band down the middle. */
function WideTable({
  caption,
  corner,
  rows,
  head,
}: {
  caption: string
  corner: string
  rows: Row[]
  head: boolean
}) {
  return (
    <table className="w-full border-separate border-spacing-0 text-left text-body">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="w-[31%] p-5 align-bottom">
            <span className="text-body-sm font-medium text-muted-foreground">{corner}</span>
          </th>
          {PLANS.map((plan) => (
            <th
              key={plan.id}
              scope="col"
              className={cn(
                'w-[23%] p-5 align-top',
                plan.id === RECOMMENDED
                  ? 'night ring-gradient rounded-t-3xl text-white'
                  : 'border-site-line border-b',
              )}
            >
              <PlanHead plan={plan} />
              {head && (
                <Cta
                  href={START_URL}
                  variant={plan.id === RECOMMENDED ? 'light' : 'outline'}
                  arrow={false}
                  className="mt-4 h-9 w-full px-4 text-body-sm"
                >
                  {translate('startWith')}
                  {plan.name}
                </Cta>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const last = i === rows.length - 1
          return (
            <tr key={row.key}>
              <th
                scope="row"
                aria-label={row.label}
                className="border-site-line border-b p-5 py-4 align-top font-normal"
              >
                <span className="flex items-start gap-3">
                  {row.icon && (
                    <span className="bg-site-tint inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground">
                      <row.icon aria-hidden className="size-4" />
                    </span>
                  )}
                  <span>
                    {row.label}
                    {(row.hint ?? row.note) && (
                      <span className="block text-body-sm text-muted-foreground">
                        {row.hint ?? row.note}
                      </span>
                    )}
                  </span>
                </span>
              </th>
              {PLANS.map((plan) => (
                <td
                  key={plan.id}
                  className={cn(
                    'p-5 py-4 align-top',
                    plan.id === RECOMMENDED
                      ? cn('bg-lilac/45', last && 'rounded-b-3xl')
                      : 'border-site-line border-b',
                  )}
                >
                  <Value text={row.cell(plan.id)} />
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function PlanList({ title, rows, plan }: { title: string; rows: Row[]; plan: PlanId }) {
  return (
    <>
      <h4 className="mt-6 text-body-sm font-medium opacity-70">{title}</h4>
      <dl className="mt-3 grid gap-3">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-4">
            <dt className="text-body-sm">
              {row.label}
              {row.hint && <span className="block text-caption opacity-60">{row.hint}</span>}
            </dt>
            <dd className="max-w-[55%] text-right text-body-sm">
              <Value text={row.cell(plan)} />
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function Heading({ children, lead }: { children: ReactNode; lead: string }) {
  return (
    <div className="mb-6 text-center">
      <h3 className="text-title font-semibold">{children}</h3>
      <p className="mx-auto mt-2 max-w-2xl text-body text-muted-foreground">{lead}</p>
    </div>
  )
}

const ALLOWANCE_LEAD = translate('whatEachPaidPersonAddsGoesIntoOneShared')

/** The plans side by side: the business benefits, then the allowances that apply before you buy. */
export function PlanTable() {
  return (
    <div className="flex flex-col gap-16">
      <div className="hidden md:flex md:flex-col md:gap-16">
        <WideTable
          caption={translate('whatEachPlanIncludes')}
          corner={translate('businessValue')}
          rows={BENEFIT_ROWS}
          head
        />
        <div>
          <Heading lead={ALLOWANCE_LEAD}>{translate('usageAllowances')}</Heading>
          <WideTable
            caption={translate('usageAllowancesOfEachPlan')}
            corner={translate('allowance')}
            rows={LIMIT_ROWS}
            head={false}
          />
        </div>
      </div>

      {/* Narrow screens: a card per plan, so nothing scrolls sideways. */}
      <div className="grid gap-4 md:hidden">
        {PLANS.map((plan) => {
          const recommended = plan.id === RECOMMENDED
          return (
            <section
              key={plan.id}
              aria-label={translate('plan', { name: plan.name })}
              className={cn(
                'rounded-3xl border p-6',
                recommended
                  ? 'night ring-gradient text-white'
                  : cn(TONES[PLAN_TONE[plan.id]].tile, TONES[PLAN_TONE[plan.id]].border),
              )}
            >
              <PlanHead plan={plan} />
              <PlanList title={translate('businessValue')} rows={BENEFIT_ROWS} plan={plan.id} />
              <PlanList title={translate('usageAllowances')} rows={LIMIT_ROWS} plan={plan.id} />
            </section>
          )
        })}
        <p className="text-center text-body-sm text-muted-foreground">{ALLOWANCE_LEAD}</p>
      </div>
    </div>
  )
}

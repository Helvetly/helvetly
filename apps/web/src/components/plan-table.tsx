import { formatPrice } from '@helvetly/ui/lib/price'
import {
  Building2,
  CalendarRange,
  Check,
  FileSignature,
  FileText,
  HardDrive,
  Infinity as Unlimited,
  type LucideIcon,
  Package,
  Receipt,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wallet,
} from 'lucide-react'

import { Cta } from '@/components/cta'
import { cn } from '@/lib/cn'
import { translate } from '@/lib/i18n'
import { type Limits, type Plan, type PlanId, PLANS, priceOf } from '@/lib/plans'
import { START_URL } from '@/lib/site'
import { type Tone, TONES } from '@/lib/tones'

const count = (n: number) => n.toLocaleString('en-US').replace(/,/g, '’')
const storage = (gb: number) => (gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`)
const tokens = (n: number) => `${n / 1_000_000} M`

// The same colours as the pricing cards: Basic sky, Pro lilac (the featured night card), Business mint.
const PLAN_TONE: Record<PlanId, Tone> = { basic: 'sky', pro: 'lilac', business: 'mint' }
const FEATURED: PlanId = 'pro'

type Row = {
  label: string
  hint?: string
  icon: LucideIcon
  /** The limit as a number for the bar, null for unlimited; omitted for rows that are text only. */
  amount?: (l: Limits) => number | null
  format: (l: Limits) => string
}

const ROWS: Row[] = [
  // Every person is billed at the plan's price, so no plan caps how many there are.
  {
    label: translate('people'),
    hint: translate('billedPerPerson'),
    icon: UsersRound,
    format: () => translate('anyNumber'),
  },
  {
    label: translate('clients'),
    icon: Building2,
    amount: (l) => l.clients,
    format: (l) => fmt(l.clients),
  },
  {
    label: translate('invoicesAMonth'),
    hint: translate('creditNotesAndCorrectionsDoNotCount'),
    icon: FileText,
    amount: (l) => l.invoicesPerMonth,
    format: (l) => fmt(l.invoicesPerMonth),
  },
  {
    label: translate('expensesAMonth'),
    icon: Receipt,
    amount: (l) => l.expensesPerMonth,
    format: (l) => fmt(l.expensesPerMonth),
  },
  {
    label: translate('productsAndServices'),
    icon: Package,
    amount: (l) => l.products,
    format: (l) => fmt(l.products),
  },
  {
    label: translate('activeEngagements'),
    icon: CalendarRange,
    amount: (l) => l.engagements,
    format: (l) => fmt(l.engagements),
  },
  {
    label: translate('signatureRequestsAMonth'),
    icon: FileSignature,
    amount: (l) => l.signaturesPerMonth,
    format: (l) => fmt(l.signaturesPerMonth),
  },
  {
    label: translate('storage'),
    hint: translate('documentsAndReceipts'),
    icon: HardDrive,
    amount: (l) => l.storageGb,
    format: (l) => storage(l.storageGb),
  },
  {
    label: translate('aiTokensAMonth'),
    hint: translate('forHeidiAndTheAIImport'),
    icon: Sparkles,
    amount: (l) => l.aiTokensPerMonth,
    format: (l) => tokens(l.aiTokensPerMonth),
  },
]

function fmt(n: number | null) {
  return n === null ? translate('unlimited') : count(n)
}

/** How full a plan's bar is: its share of the largest finite limit in the row; unlimited fills it. */
function share(row: Row, plan: Plan): number | null {
  if (!row.amount) return null
  const value = row.amount(plan.limits)
  if (value === null) return 1
  const finite = PLANS.map((p) => row.amount?.(p.limits)).filter(
    (v): v is number => typeof v === 'number',
  )
  const top = Math.max(...finite, 1)
  // A little room is kept above the largest finite limit when another plan is unlimited.
  const ceiling = finite.length < PLANS.length ? top * 1.25 : top
  return Math.max(0.06, value / ceiling)
}

// Every plan has every feature; only the limits above differ.
const FEATURES: { group: string; icon: LucideIcon; tone: Tone; items: string[] }[] = [
  {
    group: translate('invoicing'),
    icon: FileText,
    tone: 'sky',
    items: [
      translate('swissQRBillWithQRIBANQRROrSCOR'),
      translate('eightDocumentTypesGaplessNumbering'),
      translate('invoicesInGermanFrenchItalianAndEnglish'),
      translate('automaticRemindersFeesAndDefaultInterest'),
      translate('instalmentSchedulesAndPlans'),
      translate('eInvoicesXRechnungPeppolBISKSeFEFactura'),
    ],
  },
  {
    group: translate('backOffice2'),
    icon: Wallet,
    tone: 'mint',
    items: [
      translate('expensesWithReceiptsAndReverseCharge'),
      translate('clientsContactsAndAClientPortal'),
      translate('documentsWithSharingAndDuplicateDetection'),
      translate('templatesAndSimpleElectronicSignatures'),
      translate('engagementsRetainersAndServiceReports'),
      translate('vatReturnWithECH0217Export'),
    ],
  },
  {
    group: translate('aiAndSecurity'),
    icon: ShieldCheck,
    tone: 'lilac',
    items: [
      translate('heidiTheAssistantAfterConsent'),
      translate('aiImportFromPDFImagesExcelWordAndZIP'),
      translate('passkeysGoogleSignInAndTwoFactorAuthentication'),
      translate('closedPeriodsAndAHashChainedAuditLog'),
      translate('rolesForOwnersAdminsAndMembers'),
      translate('fullWorkspaceExportAsAZIP'),
    ],
  },
]

function Bar({ value, plan }: { value: number | null; plan: Plan }) {
  if (value === null) return null
  return (
    <span aria-hidden className="mt-2 block h-1.5 w-full max-w-36 rounded-full bg-foreground/8">
      <span
        style={{ width: `${Math.round(value * 100)}%` }}
        className={cn(
          'grow-x block h-full origin-left rounded-full',
          value === 1
            ? 'from-mint-solid via-sky-solid to-lilac-solid bg-linear-to-r'
            : TONES[PLAN_TONE[plan.id]].solid,
        )}
      />
    </span>
  )
}

function Value({ row, plan }: { row: Row; plan: Plan }) {
  const text = row.format(plan.limits)
  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-title-sm font-semibold tabular-nums">
        {text === 'Unlimited' && <Unlimited aria-hidden className="text-lilac-ink size-4" />}
        {text}
      </span>
      <Bar value={share(row, plan)} plan={plan} />
    </>
  )
}

function PlanHead({ plan }: { plan: Plan }) {
  const featured = plan.id === FEATURED
  return (
    <>
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn('size-2.5 rounded-full', TONES[PLAN_TONE[plan.id]].solid)}
        />
        <span className="text-title-sm font-semibold">{plan.name}</span>
        {featured && (
          <span className="ml-auto rounded-full bg-linear-to-r from-heidi-from to-heidi-to px-2 py-0.5 text-caption font-medium text-white">
            {translate('mostPopular')}
          </span>
        )}
      </span>
      <span
        className={cn(
          'mt-1 block text-body-sm font-normal',
          featured ? 'text-white/70' : 'text-muted-foreground',
        )}
      >
        {formatPrice(priceOf(plan, 'month'))}
        {translate('personMonth')}
      </span>
    </>
  )
}

/** The plans side by side: their limits with a bar for scale, then what every plan includes. */
export function PlanTable() {
  return (
    <div className="flex flex-col gap-16">
      {/* Wide screens: one table, Pro's column a lit band down the middle. */}
      <div className="hidden md:block">
        <table className="w-full border-separate border-spacing-0 text-left text-body">
          <caption className="sr-only">{translate('limitsOfEachPlan')}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[31%] p-5 align-bottom">
                <span className="text-body-sm font-medium text-muted-foreground">
                  {translate('limitsPerWorkspace')}
                </span>
              </th>
              {PLANS.map((plan) => (
                <th
                  key={plan.id}
                  scope="col"
                  className={cn(
                    'w-[23%] p-5 align-top',
                    plan.id === FEATURED
                      ? 'night ring-gradient rounded-t-3xl text-white'
                      : 'border-site-line border-b',
                  )}
                >
                  <PlanHead plan={plan} />
                  <Cta
                    href={START_URL}
                    variant={plan.id === FEATURED ? 'light' : 'outline'}
                    arrow={false}
                    className="mt-4 h-9 w-full px-4 text-body-sm"
                  >
                    {translate('startWith')}
                    {plan.name}
                  </Cta>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => {
              const last = i === ROWS.length - 1
              return (
                <tr key={row.label} className="group">
                  <th
                    scope="row"
                    aria-label={row.label}
                    className="border-site-line border-b p-5 py-4 align-top font-normal"
                  >
                    <span className="flex items-start gap-3">
                      <span className="bg-site-tint inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground">
                        <row.icon aria-hidden className="size-4" />
                      </span>
                      <span>
                        {row.label}
                        {row.hint && (
                          <span className="block text-body-sm text-muted-foreground">
                            {row.hint}
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
                        plan.id === FEATURED
                          ? cn('bg-lilac/45', last && 'rounded-b-3xl')
                          : 'border-site-line border-b',
                      )}
                    >
                      <Value row={row} plan={plan} />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: a card per plan, so nothing scrolls sideways. */}
      <div className="grid gap-4 md:hidden">
        {PLANS.map((plan) => {
          const featured = plan.id === FEATURED
          return (
            <section
              key={plan.id}
              aria-label={translate('limits', { name: plan.name })}
              className={cn(
                'rounded-3xl border p-6',
                featured
                  ? 'night ring-gradient text-white'
                  : cn(TONES[PLAN_TONE[plan.id]].tile, TONES[PLAN_TONE[plan.id]].border),
              )}
            >
              <PlanHead plan={plan} />
              <dl className="mt-5 grid gap-4">
                {ROWS.map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4">
                    <dt className="flex items-center gap-2 text-body-sm">
                      <row.icon aria-hidden className="size-4 shrink-0 opacity-60" />
                      {row.label}
                    </dt>
                    <dd className="text-right font-semibold tabular-nums">
                      {row.format(plan.limits)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>

      <div>
        <h3 className="text-center text-title font-semibold">{translate('includedInEveryPlan')}</h3>
        <p className="mx-auto mt-2 max-w-xl text-center text-body text-muted-foreground">
          {translate('plansDifferOnlyInTheLimitsAboveEveryFeature')}
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ group, icon: Icon, tone, items }, i) => (
            <section
              key={group}
              data-reveal
              style={{ ['--d' as string]: `${i * 90}ms` }}
              aria-labelledby={`included-${tone}`}
              className={cn('rounded-3xl border p-6', TONES[tone].tile, TONES[tone].border)}
            >
              <h4 id={`included-${tone}`} className="flex items-center gap-2.5 text-title-sm">
                <span
                  className={cn(
                    'inline-flex size-9 items-center justify-center rounded-xl text-white',
                    TONES[tone].solid,
                  )}
                >
                  <Icon aria-hidden className="size-4.5" />
                </span>
                <span className="font-semibold">{group}</span>
              </h4>
              <ul className="mt-5 grid gap-2.5 text-body">
                {items.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 inline-flex size-4.5 shrink-0 items-center justify-center rounded-full',
                        TONES[tone].surface,
                        TONES[tone].ink,
                      )}
                    >
                      <Check aria-hidden className="size-3" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

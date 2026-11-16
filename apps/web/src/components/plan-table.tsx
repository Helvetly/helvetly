'use client'

import type { Locale } from '@helvetly/i18n'
import { useLanguage } from '@helvetly/ui/components/language-provider'
import { formatPrice } from '@helvetly/ui/lib/price'
import { Check, Minus } from 'lucide-react'

import { Cta } from '@/components/cta'
import { useOfferStatus } from '@/components/offer-provider'
import { cn } from '@/lib/cn'
import { translatorFor } from '@/lib/i18n'
import {
  type FeatureRow,
  type LimitKey,
  type Plan,
  type PlanId,
  plansIn,
  priceOf,
  RECOMMENDED,
} from '@/lib/plans'
import { siteIn } from '@/lib/site'
import { type Tone, TONES } from '@/lib/tones'

// The same colours as the pricing cards: Basic sky, Pro lilac (the recommended plan), Business mint.
const PLAN_TONE: Record<PlanId, Tone> = { basic: 'sky', pro: 'lilac', business: 'mint' }

/** Under an allowance's number: a workspace cap, kept storage per team member, or a monthly pool per team member. */
function unitOf(limit: LimitKey, language: Locale): string {
  const translate = translatorFor(language)
  if (plansIn(language).LIMITS[limit].scope === 'workspace') return translate('perWorkspaceShort')
  return limit === 'storage_bytes'
    ? translate('perTeamMemberShort')
    : translate('perTeamMemberAMonthShort')
}

function Cell({ row, plan }: { row: FeatureRow; plan: PlanId }) {
  const language = useLanguage()
  const translate = translatorFor(language)
  const { formatLimit, isUnlimited } = plansIn(language)
  if (!row.plans[plan])
    return (
      <span className="inline-flex text-muted-foreground/60">
        <Minus aria-hidden className="size-4" />
        <span className="sr-only">{translate('notIncluded')}</span>
      </span>
    )
  if (row.limit)
    return (
      <span className="font-medium tabular-nums">
        {formatLimit(row.limit, plan)}
        {!isUnlimited(row.limit, plan) && (
          <span className="block text-caption font-normal text-muted-foreground">
            {unitOf(row.limit, language)}
          </span>
        )}
      </span>
    )
  return (
    <span
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-full',
        TONES[PLAN_TONE[plan]].surface,
        TONES[PLAN_TONE[plan]].ink,
      )}
    >
      <Check aria-hidden className="size-3.5" />
      <span className="sr-only">{translate('included')}</span>
    </span>
  )
}

function PlanHead({ plan }: { plan: Plan }) {
  const translate = translatorFor(useLanguage())
  const recommended = plan.id === RECOMMENDED
  const unavailable = useOfferStatus().status === 'unavailable'
  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
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
      <span className="mt-1 block text-body-sm font-normal text-muted-foreground">
        {unavailable
          ? translate('priceUnavailable')
          : `${formatPrice(priceOf(plan, 'month'))}${translate('personMonth')}`}
      </span>
    </>
  )
}

function StartCta({ plan }: { plan: Plan }) {
  const language = useLanguage()
  const translate = translatorFor(language)
  return (
    <Cta
      href={siteIn(language).START_URL}
      disabled={useOfferStatus().status === 'unavailable'}
      variant={plan.id === RECOMMENDED ? 'primary' : 'outline'}
      arrow={false}
      className="mt-3 min-h-9 w-full px-4 py-1.5 text-body-sm"
    >
      {translate('startWith')}
      {plan.name}
    </Cta>
  )
}

const band = (plan: PlanId) => plan === RECOMMENDED && 'bg-lilac/35'

/** Every feature side by side in one table, grouped by area, with the plans' heads pinned while it scrolls. */
function WideTable() {
  const language = useLanguage()
  const translate = translatorFor(language)
  const { FEATURE_GROUPS, PLANS } = plansIn(language)
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-left text-body">
      <caption className="sr-only">{translate('whatEachPlanIncludes')}</caption>
      <thead>
        <tr>
          <th
            scope="col"
            className="border-site-line bg-site sticky top-20 z-10 w-[34%] border-b px-3 pb-4 text-left align-bottom font-normal"
          >
            <span className="accent ink-gradient text-display">{translate('features')}</span>
          </th>
          {PLANS.map((plan) => (
            <th
              key={plan.id}
              scope="col"
              className={cn(
                'border-site-line bg-site sticky top-20 z-10 w-[22%] border-b px-5 pt-5 pb-4 align-top backdrop-blur',
                plan.id === RECOMMENDED && 'bg-lilac rounded-t-2xl',
              )}
            >
              <PlanHead plan={plan} />
              <StartCta plan={plan} />
            </th>
          ))}
        </tr>
      </thead>
      {FEATURE_GROUPS.map((group) => (
        <tbody key={group.title}>
          <tr>
            <th
              scope="colgroup"
              colSpan={PLANS.length + 1}
              className="px-3 pt-8 pb-2 text-body-sm font-semibold text-foreground"
            >
              {group.title}
            </th>
          </tr>
          {group.rows.map((row) => (
            <tr key={row.key} className="group/row">
              <th
                scope="row"
                aria-label={row.label}
                className="border-site-line group-hover/row:bg-site-tint rounded-l-lg border-t px-3 py-3 align-top font-normal transition-colors"
              >
                {row.label}
                {row.hint && (
                  <span className="block text-caption text-muted-foreground">{row.hint}</span>
                )}
              </th>
              {PLANS.map((plan) => (
                <td
                  key={plan.id}
                  className={cn(
                    'border-site-line group-hover/row:bg-site-tint border-t px-5 py-3 align-top transition-colors',
                    band(plan.id),
                  )}
                >
                  <Cell row={row} plan={plan.id} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  )
}

/** Narrow screens: a card per plan with the same groups, so nothing scrolls sideways. */
function PlanCard({ plan }: { plan: Plan }) {
  const language = useLanguage()
  const translate = translatorFor(language)
  const { FEATURE_GROUPS } = plansIn(language)
  return (
    <section
      aria-label={translate('plan', { name: plan.name })}
      className={cn(
        'rounded-3xl border p-6',
        TONES[PLAN_TONE[plan.id]].tile,
        TONES[PLAN_TONE[plan.id]].border,
      )}
    >
      <PlanHead plan={plan} />
      <StartCta plan={plan} />
      {FEATURE_GROUPS.map((group) => (
        <div key={group.title}>
          <h4 className="mt-6 text-body-sm font-semibold">{group.title}</h4>
          <dl className="mt-2 grid gap-2">
            {group.rows.map((row) => (
              <div key={row.key} className="flex items-start justify-between gap-4">
                <dt className={cn('text-body-sm', !row.plans[plan.id] && 'text-muted-foreground')}>
                  {row.label}
                </dt>
                <dd className="max-w-[50%] text-right text-body-sm">
                  <Cell row={row} plan={plan.id} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  )
}

/** The plans compared feature by feature, with the allowances in the cells that have one. */
export function PlanTable() {
  const language = useLanguage()
  const translate = translatorFor(language)
  const { PLANS } = plansIn(language)
  return (
    <div className="flex flex-col gap-6">
      <div className="hidden lg:block">
        <WideTable />
      </div>
      <div className="grid gap-4 lg:hidden">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>
      <p className="mx-auto max-w-3xl text-center text-body-sm text-muted-foreground">
        {translate('whatEachPaidPersonAddsGoesIntoOneShared')}
      </p>
    </div>
  )
}

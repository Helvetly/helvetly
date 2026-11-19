import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { cn } from '@helvetly/ui/lib/utils'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { periodLabel, type PeriodSummary } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { formatMoney, parseDecimalInput, today, UNITS, VAT_CATEGORIES } from '@/lib/invoices'

import { BillingLabel, ProgressBar } from './engagement-bits'
import {
  committedTotal,
  nextSteps,
  periodPreview,
  periodTotal,
  schedulePeriods,
  summarySentence,
  swissDate,
  type FormValues,
  type NumberedPeriod,
} from './engagement-form-model'

/** A value that is still missing is shown muted (still readable: muted is the faintest text that passes contrast). */
function Soft({ filled, children }: { filled: boolean; children: ReactNode }) {
  return filled ? children : <span className="text-muted-foreground">{children}</span>
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function Block({
  title,
  className,
  children,
}: {
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('grid gap-2.5', className)}>
      <h4 className="text-[13px] font-medium text-muted-foreground">{title}</h4>
      {children}
    </section>
  )
}

// A period with nothing used yet, so the list's real progress bar can show the committed quantity.
const emptyPeriod = (quantity: string, start: string, end: string): PeriodSummary => ({
  id: '',
  index: 1,
  starts_on: start,
  ends_on: end,
  natural_ends_on: end,
  quantity,
  full_quantity: quantity,
  unearned: '0',
  carried_in: '0',
  available: quantity,
  unit_price: '0',
  overage_unit_price: '0',
  used: '0',
  remaining: quantity,
  overage: '0',
  expected: '0',
  state: 'upcoming',
  advance_invoice: null,
  invoiced_quantity: '0',
  uninvoiced_quantity: quantity,
})

/** How the engagement will look in the list, with soft placeholders until the form says more. */
function ListPreview({ values, clientName }: { values: FormValues; clientName: string }) {
  const title = values.title.trim()
  const quantity = parseDecimalInput(values.quantity, 3)
  const hasQuantity = quantity !== null && !quantity.startsWith('-') && Number(quantity) > 0
  const unit = UNITS.find((u) => u.value === values.unit)
  const first =
    schedulePeriods(values, 1)[0] ??
    (values.end_date ? { start: values.start_date, end: values.end_date } : null)
  const dated = first !== null && first.end >= first.start
  const upcoming = values.start_date > today()
  const period = emptyPeriod(
    hasQuantity ? quantity : '30',
    first?.start ?? values.start_date,
    first?.end ?? values.start_date,
  )

  return (
    <div
      aria-hidden
      className="grid gap-2.5 rounded-lg border bg-card p-3 text-[13px] shadow-xs max-lg:hidden"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="grid min-w-0 leading-tight">
          <span className="truncate text-sm">
            <Soft filled={Boolean(title)}>{title || translate('engagementTitle')}</Soft>
          </span>
          <span className="mt-1 truncate text-muted-foreground">
            <Soft filled={Boolean(clientName)}>{clientName || translate('client')}</Soft>
            {' · '}
            <Soft filled={dated}>
              {dated
                ? periodLabel({ starts_on: first.start, ends_on: first.end })
                : translate('period')}
            </Soft>
          </span>
        </span>
        <StatusBadge tone={upcoming ? 'gray' : 'green'}>
          {upcoming ? translate('scheduled') : translate('active')}
        </StatusBadge>
      </div>
      <ProgressBar period={period} unit={unit?.value ?? null} />
      <div className="flex flex-wrap gap-1">
        <StatusBadge tone="blue">
          <BillingLabel engagement={values} />
        </StatusBadge>
        {values.auto_invoice && (
          <StatusBadge tone="amber">{translate('draftsAutomatic')}</StatusBadge>
        )}
      </div>
    </div>
  )
}

/** The live side panel: a preview of the list row, the key figures, the first periods and what follows. */
export function EngagementSummary({
  values,
  clientName,
}: {
  values: FormValues
  clientName: string
}) {
  const sentence = summarySentence(values, clientName)
  const recurring = values.recurrence !== 'none'
  const perPeriod = periodTotal(values)
  const committed = committedTotal(values)
  const money = (amount: string) => formatMoney(amount, values.currency)
  const periods = periodPreview(values)
  const category = VAT_CATEGORIES.find((c) => c.value === values.vat_category)
  const basis = values.price_basis === 'net' ? 'net' : 'gross'

  return (
    <aside
      aria-label={translate('summary')}
      className="grid shrink-0 content-start gap-5 border-b bg-muted/50 p-5 max-lg:order-first lg:w-[340px] lg:overflow-y-auto lg:border-b-0 lg:border-l xl:w-[380px] dark:bg-background"
    >
      <Block title={translate('preview')}>
        <ListPreview values={values} clientName={clientName} />
        {sentence ? (
          <p className="text-[13px] leading-snug text-pretty">{sentence}</p>
        ) : (
          <p className="text-[13px] text-muted-foreground lg:hidden">
            {translate('addAQuantityAndAStartDateToSee')}
          </p>
        )}
      </Block>

      <Block title={translate('keyFigures')} className="border-t pt-4">
        <dl className="grid gap-1.5 text-[13px]">
          {values.billing === 'paid' ? (
            <Figure label={translate('billing')} value={translate('paidSeparately')} />
          ) : (
            <>
              <Figure
                label={recurring ? translate('perPeriod') : translate('committedValue')}
                value={
                  <Soft filled={perPeriod !== null}>
                    {perPeriod === null
                      ? `${values.currency} 0.00`
                      : `${money(perPeriod)} ${basis}`}
                  </Soft>
                }
              />
              {recurring && (
                <Figure
                  label={translate('committedValue')}
                  value={committed === null ? 'Open-ended' : `${money(committed)} ${basis}`}
                />
              )}
              <Figure
                label={translate('vat')}
                value={
                  values.vat_category === 'S' ? `${values.vat_rate}%` : (category?.label ?? '')
                }
              />
            </>
          )}
        </dl>
      </Block>

      {recurring && periods.first.length > 0 && (
        <Block
          title={periods.count === null ? translate('firstPeriods') : translate('periods')}
          className="border-t pt-4 max-lg:hidden"
        >
          <ol className="grid gap-2 text-[13px] tabular-nums">
            {periods.first.map((period) => (
              <PeriodItem key={period.n} period={period} />
            ))}
            {periods.more && (
              <li className="flex items-center gap-2.5 text-muted-foreground">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-border" />…
              </li>
            )}
            {periods.last && <PeriodItem period={periods.last} />}
          </ol>
          {periods.count !== null && (
            <p className="text-body-sm text-muted-foreground">
              {translate('periodsInTotal', { count: periods.count })}
            </p>
          )}
        </Block>
      )}

      <Block title={translate('whatHappensNext')} className="border-t pt-4 max-lg:hidden">
        <ul className="grid gap-1.5 text-[13px]">
          {nextSteps(values).map((step) => (
            <li key={step} className="flex gap-2 text-muted-foreground">
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 stroke-2" />
              {step}
            </li>
          ))}
        </ul>
      </Block>
    </aside>
  )
}

function PeriodItem({ period }: { period: NumberedPeriod }) {
  return (
    <li className="flex items-center gap-2.5">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-foreground/60" />
      <span className="text-muted-foreground">{period.n}.</span>
      {swissDate(period.start)} – {swissDate(period.end)}
    </li>
  )
}

import type { Locale } from '@helvetly/i18n'
import { HelpPopover } from '@helvetly/ui/components/help-popover'
import { Logo } from '@helvetly/ui/components/logo'
import { Check, Minus } from 'lucide-react'
import Image from 'next/image'
import type { ReactNode } from 'react'

import { OfferPrice } from '@/components/offer-provider'
import { cn } from '@/lib/cn'
import {
  cellOf,
  type Competitor,
  compareIn,
  type Entry,
  offered,
  PRICE_ROWS,
  type RowKey,
} from '@/lib/compare'
import { translatorFor } from '@/lib/i18n'
import { TEAM_SIZES } from '@/lib/team-pricing'

// The shared body of every comparison page: the yearly prices by team size and the table by section. A wide screen
// gets one table with a sticky header; a phone gets one two-column card per section.

const logoClass = 'size-6 shrink-0 rounded-md bg-white p-0.5 ring-1 ring-black/5'

function HelvetlyMark({ lang }: { lang: Locale }) {
  return (
    <span className="flex items-center gap-2">
      <Logo className={logoClass} />
      {translatorFor(lang)('helvetly')}
    </span>
  )
}

function TheirMark({ them }: { them: Competitor }) {
  return (
    <span className="flex items-center gap-2">
      <Image src={them.logo} alt="" width={24} height={24} className={logoClass} />
      {them.name}
    </span>
  )
}

/** A tick, a dash or a short value, with its note behind a (?). */
function CompareValue({
  lang,
  entry,
  label,
  price = false,
}: {
  lang: Locale
  entry: Entry
  label: string
  price?: boolean
}) {
  const translate = translatorFor(lang)
  const { value, note } = cellOf(entry)
  let shown: ReactNode
  if (value === true)
    shown = (
      <>
        <Check aria-hidden className="size-4 text-brand" />
        <span className="sr-only">{translate('yes')}</span>
      </>
    )
  else if (value === false || value === null)
    shown = (
      <>
        <Minus aria-hidden className="size-4 text-placeholder" />
        <span className="sr-only">
          {translate(value === false ? 'notOffered' : 'notFoundOnTheirWebsite')}
        </span>
      </>
    )
  else shown = <span>{value}</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {price ? <OfferPrice>{shown}</OfferPrice> : shown}
      {note && (
        <HelpPopover label={translate('cmpAbout', { label })} title={label}>
          <p className="text-muted-foreground">{note}</p>
        </HelpPopover>
      )}
    </span>
  )
}

/** What a year costs for 1, 3 and 5 people, Helvetly's plans beside the other product's package. */
export function PriceBlock({ lang, them }: { lang: Locale; them: Competitor }) {
  const translate = translatorFor(lang)
  const { HELVETLY_YEARLY } = compareIn(lang)
  const cell = 'px-4 py-3 text-right tabular-nums'
  return (
    <div data-reveal className="border-site-line overflow-x-auto rounded-3xl border">
      <table className="w-full min-w-[520px] border-collapse text-left text-body">
        <caption className="sr-only">{translate('cmpYearByTeamSize')}</caption>
        <thead className="bg-site-tint text-body-sm text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {translate('cmpAYear')}
            </th>
            {TEAM_SIZES.map((people) => (
              <th key={people} scope="col" className={cn(cell, 'font-medium')}>
                {translate('cmpPeople', { count: people })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HELVETLY_YEARLY.map(({ id, plan, prices }) => (
            <tr key={id} className="border-site-line bg-mint/25 border-t">
              <th scope="row" className="px-4 py-3 font-medium">
                <span className="flex items-center gap-2">
                  <Logo className={logoClass} />
                  {translate('helvetly')} {plan}
                </span>
              </th>
              {prices.map((price, i) => (
                <td key={TEAM_SIZES[i]} className={cn(cell, 'font-medium')}>
                  <OfferPrice>{price}</OfferPrice>
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-site-line border-t text-muted-foreground">
            <th scope="row" className="px-4 py-3 font-normal">
              <span className="flex items-center gap-2">
                <Image src={them.logo} alt="" width={24} height={24} className={logoClass} />
                {them.name} {them.yearly.plan}
                <HelpPopover
                  label={translate('cmpAbout', { label: them.name })}
                  title={`${them.name} ${them.yearly.plan}`}
                >
                  <p className="text-muted-foreground">{them.yearly.note}</p>
                </HelpPopover>
              </span>
            </th>
            {them.yearly.prices.map((price, i) => (
              <td key={TEAM_SIZES[i]} className={cell}>
                {price ?? (
                  <>
                    <Minus aria-hidden className="ml-auto size-4 text-placeholder" />
                    <span className="sr-only">{translate('notFoundOnTheirWebsite')}</span>
                  </>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Feature by feature, grouped by section; rows where only Helvetly offers it are tinted. */
export function CompareTable({ lang, them }: { lang: Locale; them: Competitor }) {
  const translate = translatorFor(lang)
  const { ROW_GROUPS, OURS } = compareIn(lang)
  const wins = (key: RowKey) =>
    offered(cellOf(OURS[key]).value) && !offered(cellOf(them.rows[key]).value)
  const ours = (key: RowKey, label: string) => (
    <CompareValue lang={lang} entry={OURS[key]} label={label} price={PRICE_ROWS.has(key)} />
  )
  const theirs = (key: RowKey, label: string) => (
    <CompareValue lang={lang} entry={them.rows[key]} label={`${them.name}: ${label}`} />
  )

  return (
    <>
      {/* overflow-clip keeps the rounded corners without making a scroll box, so the header can stick. */}
      <div
        data-reveal
        className="border-site-line hidden overflow-clip rounded-3xl border md:block"
      >
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">
            {translate('helvetlyComparedWith')}
            {them.name}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="bg-site-tint sticky top-18 z-10 w-2/5 p-4">
                <span className="sr-only">{translate('cmpFeature')}</span>
              </th>
              <th
                scope="col"
                className="bg-mint sticky top-18 z-10 p-4 text-title-sm font-semibold"
              >
                <HelvetlyMark lang={lang} />
              </th>
              <th
                scope="col"
                className="bg-site-tint sticky top-18 z-10 p-4 text-title-sm font-semibold text-muted-foreground"
              >
                <TheirMark them={them} />
              </th>
            </tr>
          </thead>
          {ROW_GROUPS.map(({ group, rows }) => (
            <tbody key={group}>
              <tr className="border-site-line bg-site-tint border-t">
                <th
                  scope="rowgroup"
                  colSpan={3}
                  className="px-4 py-2.5 text-body-sm font-medium text-muted-foreground"
                >
                  {group}
                </th>
              </tr>
              {rows.map(({ key, label }) => (
                <tr
                  key={key}
                  data-win={wins(key) || undefined}
                  className={cn('border-site-line border-t', wins(key) && 'bg-mint/15')}
                >
                  <th scope="row" className="px-4 py-3 text-body font-normal">
                    {label}
                  </th>
                  {/* Helvetly's column is tinted, so it reads as one band down the table. */}
                  <td className="bg-mint/25 px-4 py-3 text-body font-medium">{ours(key, label)}</td>
                  <td className="px-4 py-3 text-body text-muted-foreground">
                    {theirs(key, label)}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="grid gap-4 md:hidden">
        {ROW_GROUPS.map(({ group, rows }) => (
          <section
            key={group}
            aria-label={group}
            className="border-site-line overflow-hidden rounded-3xl border"
          >
            <h3 className="bg-site-tint px-4 py-2.5 text-body-sm font-medium text-muted-foreground">
              {group}
            </h3>
            <div
              aria-hidden
              className="border-site-line grid grid-cols-2 border-t text-body-sm font-semibold"
            >
              <span className="bg-mint/25 px-4 py-2">
                <HelvetlyMark lang={lang} />
              </span>
              <span className="px-4 py-2 text-muted-foreground">
                <TheirMark them={them} />
              </span>
            </div>
            <dl>
              {rows.map(({ key, label }) => (
                <div
                  key={key}
                  className={cn('border-site-line border-t', wins(key) && 'bg-mint/15')}
                >
                  <dt className="px-4 pt-3 text-body-sm text-muted-foreground">{label}</dt>
                  <dd className="grid grid-cols-2 text-body">
                    <span className="px-4 py-2 font-medium">
                      <span className="sr-only">{translate('helvetly')}: </span>
                      {ours(key, label)}
                    </span>
                    <span className="px-4 py-2 text-muted-foreground">
                      <span className="sr-only">{them.name}: </span>
                      {theirs(key, label)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  )
}

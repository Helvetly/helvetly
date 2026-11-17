import { cn } from '@helvetly/ui/lib/utils'
import Image from 'next/image'

import { COUNTRY_OPTIONS } from '@/components/clients/fields'
import { streetLine } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { ibanInfo, type DocLanguage } from '@/lib/invoices'

import { vatNumber, type Values } from './onboarding-model'

const WORDS: Record<
  DocLanguage,
  { invoice: string; vat: string; total: string; terms: (days: number) => string; pay: string }
> = {
  de: {
    invoice: 'Rechnung',
    vat: 'MWST',
    total: 'Total',
    terms: (days) => `Zahlbar innert ${days} Tagen`,
    pay: 'Zahlteil',
  },
  fr: {
    invoice: 'Facture',
    vat: 'TVA',
    total: 'Total',
    terms: (days) => `Payable dans les ${days} jours`,
    pay: 'Section paiement',
  },
  it: {
    invoice: 'Fattura',
    vat: 'IVA',
    total: 'Totale',
    terms: (days) => `Pagabile entro ${days} giorni`,
    pay: 'Sezione pagamento',
  },
  en: {
    invoice: 'Invoice',
    vat: 'VAT',
    total: 'Total',
    terms: (days) => `Payable within ${days} days`,
    pay: 'Payment part',
  },
}

const LINES = [
  { text: translate('consulting'), amount: 1800 },
  { text: translate('bookkeeping'), amount: 650 },
]

/** Amounts as they print: in the document's language, grouped the way the company's country writes them. */
const money = (amount: number, currency: string, language: string, country: string) =>
  `${currency} ${amount.toLocaleString(`${language}-${country}`, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A gray bar where a value is still missing. */
const Gap = ({ className }: { className?: string }) => (
  <span className={cn('inline-block h-2 rounded-full bg-neutral-200', className)} />
)

/**
 * The welcome's right half: the first page of an invoice that fills in as the company is typed.
 * Always on white, like the PDF.
 */
export function InvoicePreview({ values, logo }: { values: Values | null; logo: string | null }) {
  const language = values?.language ?? 'de'
  const countryCode = values?.country || 'CH'
  const words = WORDS[language]
  const currency = values?.currency ?? 'CHF'
  const days = values?.default_terms_days ?? 30
  const net = LINES.reduce((sum, line) => sum + line.amount, 0)
  const vat = values?.vat_registered ? Math.round(net * 8.1) / 100 : 0
  const country = COUNTRY_OPTIONS.find((option) => option.value === values?.country)?.label
  const iban = values && ibanInfo(values.iban)
  const place = [values?.zip, values?.city].filter(Boolean).join(' ')
  const street = values ? streetLine(values) : ''

  return (
    <div className="relative w-full max-w-[25rem] rounded-xl bg-white p-7 text-[10.5px] leading-relaxed text-neutral-900 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.35),0_2px_8px_rgb(0_0_0/0.06)] ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-4">
        <span className="relative flex h-10 w-28 items-center">
          {logo ? (
            <Image
              src={logo}
              alt=""
              fill
              unoptimized
              sizes="112px"
              className="object-contain object-left"
            />
          ) : (
            <span className="flex h-10 w-24 items-center justify-center rounded-md border border-dashed border-neutral-300 text-[9px] text-neutral-500">
              {translate('logo')}
            </span>
          )}
        </span>
        <span className="grid min-w-0 justify-items-end gap-0.5 text-right">
          {values?.name ? (
            <span className="max-w-44 truncate font-semibold">{values.name}</span>
          ) : (
            <Gap className="w-28" />
          )}
          {street ? <span>{street}</span> : <Gap className="mt-1 w-20" />}
          {place ? <span>{place}</span> : <Gap className="mt-1 w-16" />}
          {country && <span className="text-neutral-500">{country}</span>}
          {values?.vat_registered && values.vat_number && (
            <span className="text-neutral-500">{vatNumber(values)}</span>
          )}
        </span>
      </div>

      <p className="mt-8 text-[15px] font-semibold tracking-tight">{words.invoice} 2026-001</p>
      <div className="mt-4 grid gap-1.5 border-t border-neutral-200 pt-3">
        {LINES.map((line) => (
          <p key={line.text} className="flex justify-between gap-4">
            <span>{line.text}</span>
            <span className="tabular-nums">
              {money(line.amount, currency, language, countryCode)}
            </span>
          </p>
        ))}
        {values?.vat_registered && (
          <p className="flex justify-between gap-4 text-neutral-500">
            <span>{words.vat} 8.1%</span>
            <span className="tabular-nums">{money(vat, currency, language, countryCode)}</span>
          </p>
        )}
        <p className="mt-1 flex justify-between gap-4 border-t border-neutral-200 pt-2 font-semibold">
          <span>{words.total}</span>
          <span className="tabular-nums">{money(net + vat, currency, language, countryCode)}</span>
        </p>
      </div>
      <p className="mt-3 text-neutral-500">{words.terms(days)}</p>

      {/* The QR bill's payment part, as on the PDF's last page. */}
      <div className="mt-6 flex gap-4 border-t border-dashed border-neutral-300 pt-4">
        <span
          aria-hidden
          className="grid size-16 shrink-0 grid-cols-6 gap-px rounded-sm bg-white p-1 ring-1 ring-neutral-300"
        >
          {Array.from({ length: 36 }, (_, i) => (
            <span key={i} className={(i * 7 + (i >> 2)) % 3 === 0 ? 'bg-neutral-900' : ''} />
          ))}
        </span>
        <span className="grid min-w-0 content-start gap-0.5">
          <span className="font-semibold">{words.pay}</span>
          {iban?.valid ? (
            <span className="font-mono text-[9.5px]">{iban.formatted}</span>
          ) : (
            <Gap className="mt-1 w-36" />
          )}
          {values?.name ? (
            <span className="truncate">{values.name}</span>
          ) : (
            <Gap className="mt-1 w-24" />
          )}
        </span>
      </div>
    </div>
  )
}

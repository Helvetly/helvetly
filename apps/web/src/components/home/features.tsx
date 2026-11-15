import {
  Bell,
  CalendarRange,
  FileCode2,
  FileSignature,
  FileText,
  Landmark,
  Receipt,
  Split,
  UsersRound,
} from 'lucide-react'

import { type Feature, FeatureExplorer } from '@/components/home/feature-explorer'
import { QrGlyph } from '@/components/home/qr-glyph'
import { Container, SectionHeading } from '@/components/section'
import { cn } from '@/lib/cn'
import { translate } from '@/lib/i18n'
import { plansWith } from '@/lib/plans'

/** A mini QR bill: the invoice's payment part, with the scissors line. */
function QrBillArt() {
  return (
    <div
      aria-hidden
      className="w-full rounded-2xl border border-border bg-card p-4 shadow-elevation-1"
    >
      <div className="flex items-center justify-between border-b border-dashed border-foreground/20 pb-2 text-caption text-muted-foreground">
        <span>{translate('paymentPart')}</span>
        <span>{translate('chf486000')}</span>
      </div>
      <div className="mt-3 flex gap-4">
        <QrGlyph className="pop size-24 shrink-0 text-foreground" />
        <dl className="grid content-start gap-1.5 text-caption">
          <div>
            <dt className="text-muted-foreground">{translate('accountPayableTo')}</dt>
            <dd className="font-mono">{translate('ch4431999123000889012')}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{translate('reference')}</dt>
            <dd className="font-mono">21 00000 00003 13947 14300 09017</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

/** The dunning ladder: notes before the due date, reminders after it. */
function DunningArt() {
  const steps = [
    { day: '−3', label: translate('friendlyNote'), tone: 'bg-info-solid' },
    { day: '+7', label: translate('message1stReminder'), tone: 'bg-warning-solid' },
    { day: '+21', label: translate('message2ndCHF20Fee'), tone: 'bg-warning-solid' },
    { day: '+35', label: translate('final5Interest'), tone: 'bg-destructive' },
  ]
  return (
    <ol aria-hidden className="relative grid w-full gap-2.5">
      {steps.map((s, i) => (
        <li
          key={s.day}
          className="pop flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-body-sm"
          style={{ ['--d' as string]: `${200 + i * 160}ms` }}
        >
          <span className={cn('size-2 rounded-full', s.tone)} />
          <span className="flex-1">{s.label}</span>
          <span className="font-mono text-caption text-muted-foreground">
            {translate('day')}
            {s.day}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** A receipt being read: a scan line sweeping, fields filling in. */
function ReceiptArt() {
  return (
    <div aria-hidden className="flex w-full items-end gap-3">
      <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-card p-2.5">
        {[70, 50, 85, 40, 60, 30].map((w) => (
          <div
            key={w}
            className="mb-1.5 h-1 rounded-full bg-foreground/12"
            style={{ width: `${w}%` }}
          />
        ))}
        <div className="mt-3 h-1.5 w-1/2 rounded-full bg-foreground/30" />
        <div className="animate-scan absolute inset-x-0 h-6 bg-linear-to-b from-transparent via-heidi/25 to-transparent" />
      </div>
      <dl className="grid flex-1 gap-1.5 text-caption">
        {[
          ['Merchant', 'SBB CFF FFS'],
          ['Date', '04.11.2026'],
          ['Total', 'CHF 88.00'],
          [translate('vat'), '8.1% · 6.59'],
        ].map(([k, v], i) => (
          <div
            key={k}
            className="pop flex justify-between rounded-md bg-card px-2 py-1"
            style={{ ['--d' as string]: `${300 + i * 140}ms` }}
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** A signature drawing itself on the line. */
function SignatureArt() {
  return (
    <div aria-hidden className="w-full rounded-2xl border border-border bg-card p-4">
      <svg viewBox="0 0 260 70" className="h-16 w-full text-foreground">
        <path
          className="draw"
          style={{ ['--len' as string]: 520 }}
          d="M8 48c14-22 22-36 30-34 9 2-10 40-2 42 8 2 18-30 26-28 7 2-2 24 6 24 9 0 15-22 24-20 7 2 0 20 8 20s14-16 22-16 4 14 12 14 12-10 20-12c10-2 8 10 18 8 12-2 30-18 52-20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-caption text-muted-foreground">
        <span>{translate('annaKellerManagingDirector')}</span>
        <span className="text-success">{translate('signed')}</span>
      </div>
    </div>
  )
}

/** Four instalments, each with its own QR bill. */
function InstalmentArt() {
  return (
    <div aria-hidden className="grid w-full grid-cols-4 gap-2">
      {['Jan', 'Feb', 'Mar', 'Apr'].map((m, i) => (
        <div
          key={m}
          className="pop rounded-xl border border-border bg-card p-2.5 text-center"
          style={{ ['--d' as string]: `${i * 120}ms` }}
        >
          <p className="text-caption text-muted-foreground">{m}</p>
          <p className="text-body-sm font-semibold tabular-nums">1’215</p>
          <div
            className={cn(
              'mx-auto mt-2 h-1 w-8 rounded-full',
              i === 0 ? 'bg-success-solid' : 'bg-foreground/12',
            )}
          />
        </div>
      ))}
    </div>
  )
}

/** Committed hours used against the plan for the month. */
function EngagementArt() {
  return (
    <div aria-hidden className="w-full rounded-2xl border border-border bg-card p-4">
      <div className="flex justify-between text-body-sm">
        <span className="font-medium">{translate('monthlyRetainerStudioLumen')}</span>
        <span className="text-muted-foreground">{translate('message3240H')}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/8">
        <div className="grow-x from-rose-solid to-peach-solid h-full w-4/5 origin-left rounded-full bg-linear-to-r" />
      </div>
      <p className="mt-2 text-caption text-muted-foreground">
        {translate('draftInvoiceReadyOn30November')}
      </p>
    </div>
  )
}

/** The Ziffern of the VAT return, adding up. */
function VatArt() {
  const rows = [
    ['200', translate('totalAgreedConsideration'), '248’260.00'],
    ['302', translate('suppliesAt81'), '231’400.00'],
    ['405', translate('inputTaxOnCosts'), '−4’312.15'],
  ]
  return (
    <div
      aria-hidden
      className="w-full overflow-hidden rounded-2xl border border-border bg-card text-caption"
    >
      {rows.map(([z, label, amount], i) => (
        <div
          key={z}
          className="pop flex gap-3 border-b border-border px-3 py-2"
          style={{ ['--d' as string]: `${i * 140}ms` }}
        >
          <span className="font-mono text-muted-foreground">{z}</span>
          <span className="flex-1 truncate">{label}</span>
          <span className="tabular-nums">{amount}</span>
        </div>
      ))}
      <div className="flex justify-between bg-brand-surface px-3 py-2 font-medium text-brand">
        <span>{translate('taxPayable')}</span>
        <span className="tabular-nums">14’431.25</span>
      </div>
    </div>
  )
}

/** The client's own view: invoices to pay and documents shared with them. */
function PortalArt() {
  const rows = [
    [translate('invoice20260418'), translate('chf486000'), translate('open')],
    ['Service agreement.pdf', translate('shared0211'), translate('new')],
    [translate('invoice20260377'), translate('chf210000'), translate('paid')],
  ]
  return (
    <div aria-hidden className="w-full overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-caption text-muted-foreground">
        <span className="size-5 rounded-full bg-linear-to-br from-logo-from to-logo-to" />
        {translate('alpenglHnGmbHClientPortal')}
      </div>
      {rows.map(([name, meta, status], i) => (
        <div
          key={name}
          className="pop flex items-center gap-3 px-3 py-2 text-body-sm"
          style={{ ['--d' as string]: `${i * 140}ms` }}
        >
          <span className="flex-1 truncate font-medium">{name}</span>
          <span className="text-caption text-muted-foreground tabular-nums">{meta}</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-caption font-medium',
              status === 'Paid'
                ? 'bg-success-surface text-success'
                : status === 'New'
                  ? 'bg-info-surface text-info'
                  : 'bg-warning-surface text-warning',
            )}
          >
            {status}
          </span>
        </div>
      ))}
    </div>
  )
}

/** One invoice, five machine-readable formats. */
function EinvoiceArt() {
  const formats = [
    translate('xrechnungUBL'),
    translate('xrechnungCII'),
    translate('peppolBIS'),
    translate('ksefFA3'),
    translate('roEFactura'),
  ]
  return (
    <div aria-hidden className="flex w-full items-center gap-4">
      <div className="relative flex h-28 w-22 shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
        <div className="h-1.5 w-1/2 rounded-full bg-brand-solid/60" />
        {[80, 60, 70, 40].map((w) => (
          <div key={w} className="h-1 rounded-full bg-foreground/12" style={{ width: `${w}%` }} />
        ))}
        <span className="absolute -right-2 -bottom-2 rounded-md bg-foreground px-1.5 py-0.5 font-mono text-caption text-background">
          .xml
        </span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {formats.map((f, i) => (
          <li
            key={f}
            className="pop rounded-full border border-border bg-card px-2.5 py-1 text-caption font-medium"
            style={{ ['--d' as string]: `${i * 110}ms` }}
          >
            {f}
          </li>
        ))}
      </ul>
    </div>
  )
}

// One entry per product area; the explorer shows one at a time, in its tone.
const FEATURES: Feature[] = [
  {
    id: 'invoices',
    facts: [translate('swissQRBill'), translate('deFRITEN')],
    tone: 'mint',
    icon: <FileText />,
    label: translate('qrInvoices'),
    title: translate('invoicesWithTheQRBillBuiltIn'),
    body: translate('eightDocumentTypesFromPrepaymentToCreditNoteGapless'),
    art: <QrBillArt />,
  },
  {
    id: 'reminders',
    facts: [
      translate('upTo10Steps'),
      translate('in', { value1: plansWith('automations', 'conjunction') }),
    ],
    tone: 'peach',
    icon: <Bell />,
    label: translate('reminders'),
    title: translate('remindersThatSendThemselves'),
    body: translate('upToTenStepsBeforeAndAfterTheDue'),
    art: <DunningArt />,
  },
  {
    id: 'expenses',
    facts: [
      translate('pdfPhotoOrExcel'),
      translate('in', { value1: plansWith('expenses', 'conjunction') }),
    ],
    tone: 'lemon',
    icon: <Receipt />,
    label: translate('expenses'),
    title: translate('expensesReadForYou'),
    body: translate('dropInReceiptsPDFsOrASpreadsheetHelvetlyReads'),
    art: <ReceiptArt />,
  },
  {
    id: 'signatures',
    facts: [
      translate('simpleESignature'),
      translate('in', { value1: plansWith('templates_signatures', 'conjunction') }),
    ],
    tone: 'lilac',
    icon: <FileSignature />,
    label: translate('signatures'),
    title: translate('contractsSignedOnline'),
    body: translate('sendAnyPDFForSignatureFillTemplatesWithClient'),
    art: <SignatureArt />,
  },
  {
    id: 'instalments',
    facts: [
      translate('oneQRBillPerPart'),
      translate('in', { value1: plansWith('automations', 'conjunction') }),
    ],
    tone: 'sky',
    icon: <Split />,
    label: translate('instalments'),
    title: translate('instalmentsAutomatically'),
    body: translate('splitAnInvoiceIntoPartsEachWithItsOwn'),
    art: <InstalmentArt />,
  },
  {
    id: 'engagements',
    facts: [translate('hoursUsedLive'), translate('draftsOnTime')],
    tone: 'rose',
    icon: <CalendarRange />,
    label: translate('retainers'),
    title: translate('retainersAndEngagements'),
    body: translate('trackCommittedHoursPerClientSeeWhatIsUsed'),
    art: <EngagementArt />,
  },
  {
    id: 'vat',
    facts: [
      translate('ech0217File'),
      translate('in', { value1: plansWith('corrections_vat', 'conjunction') }),
    ],
    tone: 'mint',
    icon: <Landmark />,
    label: translate('vatReturn'),
    title: translate('theVATReturnPrepared'),
    body: translate('effectiveOrNetTaxRateMethodAgreedOrReceived'),
    art: <VatArt />,
  },
  {
    id: 'portal',
    facts: [
      translate('signInByEmailCode'),
      translate('in', { value1: plansWith('client_portal') }),
    ],
    tone: 'lilac',
    icon: <UsersRound />,
    label: translate('clientPortal'),
    title: translate('aPortalForYourClients'),
    body: translate('clientsSignInWithAnEmailedCodeToSee'),
    art: <PortalArt />,
  },
  {
    id: 'einvoices',
    facts: [
      translate('xmlFilesToSendYourself'),
      translate('in', { value1: plansWith('einvoice_xml') }),
    ],
    tone: 'sky',
    icon: <FileCode2 />,
    label: translate('eInvoices'),
    title: translate('eInvoicesForEurope'),
    body: translate('xrechnungPeppolBISPolishKSeFAndRomanianEFactura2'),
    art: <EinvoiceArt />,
  },
]

export function Features() {
  return (
    <section id="features" className="pt-12 pb-4 sm:pt-16">
      <Container>
        <SectionHeading
          eyebrow={translate('everythingInOnePlace')}
          title={
            <>
              {translate('fromTheFirstInvoiceToThe')}
              <span className="accent">{translate('filed')}</span>
              {translate('return')}
            </>
          }
          lead={translate('everyToolASwissCompanyNeedsToGetPaid')}
        />
        <div data-reveal className="mt-12">
          <FeatureExplorer features={FEATURES} />
        </div>
      </Container>
    </section>
  )
}

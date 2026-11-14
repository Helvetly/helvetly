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

/** A mini QR bill: the invoice's payment part, with the scissors line. */
function QrBillArt() {
  return (
    <div
      aria-hidden
      className="w-full rounded-2xl border border-border bg-card p-4 shadow-elevation-1"
    >
      <div className="flex items-center justify-between border-b border-dashed border-foreground/20 pb-2 text-caption text-muted-foreground">
        <span>✂ Payment part</span>
        <span>CHF 4’860.00</span>
      </div>
      <div className="mt-3 flex gap-4">
        <QrGlyph className="pop size-24 shrink-0 text-foreground" />
        <dl className="grid content-start gap-1.5 text-caption">
          <div>
            <dt className="text-muted-foreground">Account / Payable to</dt>
            <dd className="font-mono">CH44 3199 9123 0008 8901 2</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reference</dt>
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
    { day: '−3', label: 'Friendly note', tone: 'bg-info-solid' },
    { day: '+7', label: '1st reminder', tone: 'bg-warning-solid' },
    { day: '+21', label: '2nd · CHF 20 fee', tone: 'bg-warning-solid' },
    { day: '+35', label: 'Final · 5% interest', tone: 'bg-destructive' },
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
          <span className="font-mono text-caption text-muted-foreground">day {s.day}</span>
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
          ['VAT', '8.1% · 6.59'],
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
        <span>Anna Keller · Managing director</span>
        <span className="text-success">Signed ✓</span>
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
        <span className="font-medium">Monthly retainer · Studio Lumen</span>
        <span className="text-muted-foreground">32 / 40 h</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/8">
        <div className="grow-x from-rose-solid to-peach-solid h-full w-4/5 origin-left rounded-full bg-linear-to-r" />
      </div>
      <p className="mt-2 text-caption text-muted-foreground">Draft invoice ready on 30 November</p>
    </div>
  )
}

/** The Ziffern of the VAT return, adding up. */
function VatArt() {
  const rows = [
    ['200', 'Total agreed consideration', '248’260.00'],
    ['302', 'Supplies at 8.1%', '231’400.00'],
    ['405', 'Input tax on costs', '−4’312.15'],
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
        <span>Tax payable</span>
        <span className="tabular-nums">14’431.25</span>
      </div>
    </div>
  )
}

/** The client's own view: invoices to pay and documents shared with them. */
function PortalArt() {
  const rows = [
    ['Invoice 2026-0418', 'CHF 4’860.00', 'Open'],
    ['Service agreement.pdf', 'Shared 02.11.', 'New'],
    ['Invoice 2026-0377', 'CHF 2’100.00', 'Paid'],
  ]
  return (
    <div aria-hidden className="w-full overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-caption text-muted-foreground">
        <span className="size-5 rounded-full bg-linear-to-br from-logo-from to-logo-to" />
        Alpenglühn GmbH · Client portal
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
  const formats = ['XRechnung UBL', 'XRechnung CII', 'Peppol BIS', 'KSeF FA(3)', 'RO e-Factura']
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
    facts: ['Swiss QR bill', 'DE · FR · IT · EN'],
    tone: 'mint',
    icon: <FileText />,
    label: 'QR invoices',
    title: 'Invoices with the QR bill built in',
    body: 'Eight document types, from prepayment to credit note, gapless numbers per series and year, PDFs in German, French, Italian or English with the Swiss QR bill attached.',
    art: <QrBillArt />,
  },
  {
    id: 'reminders',
    facts: ['Up to 10 steps', '5% interest, worked out'],
    tone: 'peach',
    icon: <Bell />,
    label: 'Reminders',
    title: 'Reminders that send themselves',
    body: 'Up to ten steps, before and after the due date, with fees and default interest worked out for you.',
    art: <DunningArt />,
  },
  {
    id: 'expenses',
    facts: ['PDF, photo or Excel', 'VAT split for you'],
    tone: 'lemon',
    icon: <Receipt />,
    label: 'Expenses',
    title: 'Expenses, read for you',
    body: 'Drop in receipts, PDFs or a spreadsheet. Helvetly reads them and you approve what goes into the books.',
    art: <ReceiptArt />,
  },
  {
    id: 'signatures',
    facts: ['Audit trail', 'Signed in minutes'],
    tone: 'lilac',
    icon: <FileSignature />,
    label: 'Signatures',
    title: 'Contracts signed online',
    body: 'Send any PDF for signature, fill templates with client data, and keep a tamper-evident audit trail.',
    art: <SignatureArt />,
  },
  {
    id: 'instalments',
    facts: ['One QR bill per part', 'Reminders per part'],
    tone: 'sky',
    icon: <Split />,
    label: 'Instalments',
    title: 'Instalments, automatically',
    body: 'Split an invoice into parts, each with its own QR bill and reminder, or issue them on a schedule.',
    art: <InstalmentArt />,
  },
  {
    id: 'engagements',
    facts: ['Hours used live', 'Drafts on time'],
    tone: 'rose',
    icon: <CalendarRange />,
    label: 'Retainers',
    title: 'Retainers and engagements',
    body: 'Track committed hours per client, see what is used, and get the draft invoice in advance or in arrears.',
    art: <EngagementArt />,
  },
  {
    id: 'vat',
    facts: ['eCH-0217 file', 'Effective or net rate'],
    tone: 'mint',
    icon: <Landmark />,
    label: 'VAT return',
    title: 'The VAT return, prepared',
    body: 'Effective or net tax rate method, agreed or received basis. Export the eCH-0217 file the ESTV ePortal imports.',
    art: <VatArt />,
  },
  {
    id: 'portal',
    facts: ['Sign in by email code', 'Invoices and files'],
    tone: 'lilac',
    icon: <UsersRound />,
    label: 'Client portal',
    title: 'A portal for your clients',
    body: 'Clients sign in with an emailed code to see their invoices, shared documents and engagements, and ask for profile changes you approve.',
    art: <PortalArt />,
  },
  {
    id: 'einvoices',
    facts: ['XRechnung · Peppol', 'KSeF · e-Factura'],
    tone: 'sky',
    icon: <FileCode2 />,
    label: 'E-invoices',
    title: 'E-invoices for Europe',
    body: 'XRechnung, Peppol BIS, Polish KSeF and Romanian e-Factura from your issued invoices, each archived with a checksum.',
    art: <EinvoiceArt />,
  },
]

export function Features() {
  return (
    <section id="features" className="pt-12 pb-4 sm:pt-16">
      <Container>
        <SectionHeading
          eyebrow="Everything in one place"
          title={
            <>
              From the first invoice to the <span className="accent">filed</span> return
            </>
          }
          lead="Every tool a Swiss company needs to get paid, stay compliant and keep its paperwork tidy, built to work together instead of bolted on."
        />
        <div data-reveal className="mt-12">
          <FeatureExplorer features={FEATURES} />
        </div>
      </Container>
    </section>
  )
}

import type { Locale } from '@helvetly/i18n'
import { HeidiMark } from '@helvetly/ui/components/heidi-mark'
import { LogoMark } from '@helvetly/ui/components/logo'
import {
  CalendarRange,
  FileSignature,
  FileText,
  Folder,
  LayoutDashboard,
  Receipt,
  Search,
  Users,
} from 'lucide-react'

import { CountUp } from '@/components/count-up'
import { cn } from '@/lib/cn'
import { translatorFor } from '@/lib/i18n'

// The hero's picture of the product: the platform's dashboard drawn in HTML, so it is sharp at any
// size, follows the theme and can move. The figures are sample data.

// Monthly revenue in thousands, Jan–Dec.
const BARS = [14, 18, 16, 22, 19, 25, 21, 27, 24, 30, 28, 34]

const STATUS: Record<string, string> = {
  Paid: 'bg-success-surface text-success',
  Sent: 'bg-info-surface text-info',
  Overdue: 'bg-warning-surface text-warning',
}

function Pill({ lang, status, className }: { lang: Locale; status: string; className?: string }) {
  const translate = translatorFor(lang)
  return (
    <span
      className={cn('rounded-full px-2 py-0.5 text-caption font-medium', STATUS[status], className)}
    >
      {{ Paid: translate('paid'), Sent: translate('sent'), Overdue: translate('overdue') }[status]}
    </span>
  )
}

export function ProductWindow({ lang }: { lang: Locale }) {
  const translate = translatorFor(lang)
  const INVOICES = [
    { client: translate('alpenglHnGmbH'), no: '2026-0418', amount: '4’860.00', status: 'live' },
    { client: translate('studioLumen'), no: '2026-0417', amount: '1’250.00', status: 'Paid' },
    {
      client: translate('rheinConsultingAG'),
      no: '2026-0416',
      amount: '9’720.00',
      status: 'Overdue',
    },
    { client: translate('bergwerkDesign'), no: '2026-0415', amount: '2’340.50', status: 'Paid' },
  ] as const
  const KPIS = [
    {
      label: translate('revenueThisYear'),
      value: 248260,
      delta: '+18.4%',
      tone: 'text-success',
      bar: 'bg-mint-solid',
    },
    {
      label: translate('openReceivables'),
      value: 32940,
      delta: translate('message14Invoices'),
      tone: 'text-muted-foreground',
      bar: 'bg-sky-solid',
    },
    {
      label: translate('overdue'),
      value: 4180,
      delta: translate('message3Invoices'),
      tone: 'text-warning',
      bar: 'bg-peach-solid',
    },
    {
      label: translate('expenses'),
      value: 61410,
      delta: '−6.2%',
      tone: 'text-success',
      bar: 'bg-lilac-solid',
    },
  ]
  const NAV = [
    { icon: LayoutDashboard, label: translate('dashboard'), active: true },
    { icon: FileText, label: translate('invoices') },
    { icon: Receipt, label: translate('expenses') },
    { icon: Users, label: translate('clients') },
    { icon: Folder, label: translate('documents') },
    { icon: CalendarRange, label: translate('engagements') },
    { icon: FileSignature, label: translate('signatures') },
  ]
  return (
    <div
      aria-hidden
      className="border-site-line overflow-hidden rounded-[20px] border bg-card shadow-[0_50px_140px_-40px_rgb(85_39_201/0.45),0_30px_80px_-40px_rgb(18_179_155/0.4)] select-none dark:shadow-[0_40px_120px_-30px_rgb(0_0_0/0.8)]"
    >
      {/* Browser chrome */}
      <div className="border-site-line bg-site-tint flex h-10 items-center gap-3 border-b px-4">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-foreground/12" />
          <span className="size-2.5 rounded-full bg-foreground/12" />
          <span className="size-2.5 rounded-full bg-foreground/12" />
        </div>
        <div className="mx-auto flex h-6 w-56 items-center justify-center rounded-md bg-card text-caption text-muted-foreground">
          app.helvetly.com
        </div>
        <div className="w-10" />
      </div>

      <div className="flex bg-background text-left">
        {/* Sidebar */}
        <div className="hidden w-48 shrink-0 flex-col gap-0.5 p-3 lg:flex">
          <div className="mb-3 flex items-center gap-2 px-2 py-1">
            <span className="inline-flex size-6 items-center justify-center rounded-[28%] bg-linear-to-br from-logo-from to-logo-to text-white">
              <LogoMark className="size-[62%]" />
            </span>
            <span className="text-body-sm font-semibold">{translate('acmeTreuhand')}</span>
          </div>
          {NAV.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-body-sm',
                active
                  ? 'bg-sidebar-accent font-medium text-foreground'
                  : 'text-sidebar-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </div>
          ))}
          <div className="mt-3 flex items-center gap-2 rounded-md bg-heidi-soft/70 px-2 py-1.5 text-body-sm font-medium text-heidi-ink">
            <HeidiMark className="size-4" animated />
            {translate('askHeidi')}
          </div>
        </div>

        {/* Main panel */}
        <div className="m-2 flex min-w-0 flex-1 flex-col gap-3 rounded-xl bg-card p-4 shadow-elevation-1 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-caption text-muted-foreground">
                {translate('wednesday11November')}
              </p>
              <p className="text-title font-semibold tracking-tight">
                {translate('goodMorningAnna')}
              </p>
            </div>
            <div className="hidden h-8 w-44 items-center gap-2 rounded-lg border border-input px-2.5 text-body-sm text-placeholder sm:flex">
              <Search className="size-3.5" />
              {translate('search')}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {KPIS.map((kpi) => (
              <div
                key={kpi.label}
                className="relative overflow-hidden rounded-lg border border-border p-3"
              >
                <span aria-hidden className={cn('absolute inset-x-0 top-0 h-0.5', kpi.bar)} />
                <p className="truncate text-caption text-muted-foreground">{kpi.label}</p>
                <p className="mt-1 text-title-sm font-semibold sm:text-title">
                  <span className="mr-1 text-caption font-medium text-muted-foreground">CHF</span>
                  <CountUp to={kpi.value} />
                </p>
                <p className={cn('text-caption', kpi.tone)}>{kpi.delta}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-2.5 md:grid-cols-[1.25fr_1fr]">
            <div data-reveal className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-body-sm font-medium">{translate('revenue')}</p>
                <p className="text-caption text-muted-foreground">
                  {translate('message2026CHFThousands')}
                </p>
              </div>
              <div className="mt-3 flex h-32 items-end gap-1.5">
                {BARS.map((height, i) => (
                  <div
                    key={height}
                    className={cn(
                      'grow-bar flex-1 origin-bottom rounded-t-[4px]',
                      i === BARS.length - 1
                        ? 'from-mint-solid to-lilac-solid bg-linear-to-t'
                        : 'from-mint-solid/25 to-lilac-solid/30 bg-linear-to-t',
                    )}
                    style={{ height: `${(height / 34) * 100}%`, ['--d' as string]: `${i * 60}ms` }}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-body-sm font-medium">{translate('latestInvoices')}</p>
                <p className="text-caption text-link">{translate('viewAll')}</p>
              </div>
              <ul className="mt-2 divide-y divide-border">
                {INVOICES.map((inv) => (
                  <li key={inv.no} className="flex items-center gap-2 py-2 text-body-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{inv.client}</span>
                      <span className="text-caption text-muted-foreground">{inv.no}</span>
                    </span>
                    <span className="tabular-nums">{inv.amount}</span>
                    {inv.status === 'live' ? (
                      // Sent, then the payment arrives: the pill flips to Paid on a loop.
                      <span className="relative grid">
                        <Pill
                          lang={lang}
                          status="Sent"
                          className="loop-sent col-start-1 row-start-1"
                        />
                        <Pill
                          lang={lang}
                          status="Paid"
                          className="loop-paid col-start-1 row-start-1 opacity-0"
                        />
                      </span>
                    ) : (
                      <Pill lang={lang} status={inv.status} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

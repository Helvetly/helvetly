'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Disclosure } from '@helvetly/ui/components/disclosure'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { FormField } from '@helvetly/ui/components/form-field'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@helvetly/ui/components/sheet'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  PencilLine,
  Plus,
  Sheet as SheetIcon,
  TriangleAlert,
  Trash2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { FeatureLockNotice, useFeatureLock } from '@/components/billing/feature-lock'
import { NativeSelect } from '@/components/clients/fields'
import { fixCount, FixDialog, FixLink, FixList } from '@/components/fix-list'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { ApiError, errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { saveResponse } from '@/lib/invoice-download'
import { formatAmount, settingsFix, today } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import {
  endedPeriods,
  exportReasons,
  vatReturnApi,
  type ExportReason,
  vatReturnFileUrl,
  type VATReturn,
  type VATReturnLine,
  type VATReturnSettings,
} from '@/lib/vat-return'

import { HelpTip } from './help-tip'
import { SettingsPage } from './layout'
import { SettingsHeader } from './settings-tabs'
import { UnitInput } from './unit-input'

const SETTINGS_KEY = ['vat-return', 'settings'] as const
const reportKey = (period: string) => ['vat-return', 'report', period] as const
// Framed by a hairline, not raised: a summary and a table of figures, not cards.
const card = 'rounded-xl border border-border bg-card'
const drawer = 'w-full! max-w-none! gap-0 bg-card p-0 sm:w-[min(720px,100vw)]!'

const METHODS = {
  effective: translate('effectiveMethod'),
  net_tax_rate: translate('netTaxRateMethod'),
} as const
const BASES = {
  agreed: translate('agreedConsideration'),
  received: translate('receivedConsideration'),
} as const
const LENGTHS = {
  quarterly: translate('quarterly'),
  half_yearly: translate('halfYearly'),
  monthly: translate('monthly2'),
  yearly: translate('yearly3'),
} as const

const isKey = <T extends object>(options: T, value: PropertyKey): value is keyof T =>
  value in options

type RateRow = VATReturnSettings['net_rates'][number] & { key: string }
type Draft = Omit<VATReturnSettings, 'net_rates'> & { net_rates: RateRow[] }
let rowCount = 0
const withKeys = (settings: VATReturnSettings): Draft => ({
  ...settings,
  net_rates: settings.net_rates.map((rate) => ({ ...rate, key: `rate-${++rowCount}` })),
})
const withoutKeys = ({ net_rates, ...rest }: Draft): VATReturnSettings => ({
  ...rest,
  net_rates: net_rates.map(({ label, rate }) => ({ label, rate })),
})

/** The ESTV wants the return, and the payment, within 60 days of the period's end (Art. 71/86 MWSTG). */
export function dueBy(to: string): string {
  const date = new Date(`${to}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 60)
  return date.toISOString().slice(0, 10)
}

export function VATReturnPage() {
  const lock = useFeatureLock('vat_returns')
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => (await vatReturnApi.settings()).data,
    enabled: !lock,
  })
  const periods = settings.data ? endedPeriods(settings.data.period, today(), 8) : []
  const reports = useQueries({
    queries: periods.map((period) => ({
      queryKey: reportKey(period),
      queryFn: async () => (await vatReturnApi.report(period)).data,
    })),
  })
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [refused, setRefused] = useState<ExportReason[] | null>(null)
  const estv = useMutation({
    mutationFn: async (name: string) =>
      saveResponse(await vatReturnApi.estvXml(name), `MWST_${name}.xml`),
    onError: (error) => {
      const reasons = error instanceof ApiError ? exportReasons(error.details) : []
      if (reasons.length) setRefused(reasons)
      else toast.error(errorMessage(error))
    },
  })
  const latest = periods[0]
  const current = reports[0]
  const exports = { exporting: estv.isPending, onEstv: (period: string) => estv.mutate(period) }
  const openReport = open ? reports[periods.indexOf(open)]?.data : undefined

  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title={translate('vatReturn')}
        description={translate('theFiguresOfTheESTVVATReturnMWSTAbrechnung')}
      >
        {lock ? (
          <FeatureLockNotice lock={lock} kept={translate('vatOnYourInvoicesIsStillCalculatedIn')} />
        ) : settings.error ? (
          <p className="text-body text-muted-foreground">{errorMessage(settings.error)}</p>
        ) : settings.data && latest ? (
          <>
            <SettleRow settings={settings.data} onEdit={() => setEditing(true)} />
            {current?.error ? (
              <p className="text-body text-muted-foreground">{errorMessage(current.error)}</p>
            ) : current?.data ? (
              <CurrentReturn report={current.data} onDetails={() => setOpen(latest)} {...exports} />
            ) : (
              <Loader className="min-h-72" />
            )}
            <PeriodList
              periods={periods.map((period, i) => ({ period, report: reports[i]?.data }))}
              onOpen={setOpen}
            />
          </>
        ) : (
          <Loader className="min-h-96" />
        )}
      </SettingsPage>
      {open && (
        <PeriodDrawer
          period={open}
          report={openReport}
          onClose={() => setOpen(null)}
          {...exports}
        />
      )}
      {editing && settings.data && (
        <SettleDrawer settings={settings.data} onClose={() => setEditing(false)} />
      )}
      {refused && <ExportBlockersDialog reasons={refused} onClose={() => setRefused(null)} />}
    </>
  )
}

/** How VAT is settled, in one line: it rarely changes, so it is edited in a drawer. */
function SettleRow({ settings, onEdit }: { settings: VATReturnSettings; onEdit: () => void }) {
  const canEdit = useCan('write:vat-return')
  const rates = settings.method === 'net_tax_rate' ? settings.net_rates : []
  return (
    <section
      aria-labelledby="vat-settle-title"
      className={cn(card, 'flex items-center gap-4 px-5 py-3.5')}
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-lg border text-muted-foreground max-sm:hidden [&_svg]:size-4"
      >
        <Calculator />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h2 id="vat-settle-title" className="text-body-sm text-muted-foreground">
          {translate('howYouSettleVAT')}
        </h2>
        <p className="text-body font-medium text-pretty">
          {[
            METHODS[settings.method],
            LENGTHS[settings.period],
            BASES[settings.basis],
            ...(rates.length ? [rates.map((rate) => `${rate.rate}%`).join(', ')] : []),
          ].join(' · ')}
        </p>
        {!canEdit && (
          <p className="text-body-sm text-muted-foreground">
            {translate('viewOnlyAskAnOwnerOrAdminForEditAccess')}
          </p>
        )}
      </div>
      {canEdit && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={onEdit}>
          <PencilLine aria-hidden />
          {translate('edit4')}
        </Button>
      )}
    </section>
  )
}

/** The latest period that has ended: what to file now, how much, by when, and how. */
function CurrentReturn({
  report,
  onDetails,
  exporting,
  onEstv,
}: {
  report: VATReturn
  onDetails: () => void
  exporting: boolean
  onEstv: (period: string) => void
}) {
  const result = resultOf(report)
  const look = RESULTS[result.state]
  const taxDue = amountOf(report, '399')
  const inputTax = amountOf(report, '479')
  return (
    <section aria-labelledby="vat-current-title" className={cn(card, 'overflow-hidden')}>
      <header className="flex flex-wrap items-end gap-x-3 gap-y-1.5 border-b border-border/60 px-5 py-4">
        <div className="grid gap-0.5">
          <span className="text-caption font-medium text-muted-foreground">
            {translate('toFileNow')}
          </span>
          <h2 id="vat-current-title" className="text-title-sm font-semibold tabular-nums">
            {report.period}
          </h2>
        </div>
        <span className="pb-0.5 text-body-sm text-muted-foreground">
          {formatDate(report.from)} – {formatDate(report.to)}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5 self-center">
          <ClosedBadge report={report} />
          <StatusBadge tone="gray">
            {translate('due3')}
            {formatDate(dueBy(report.to))}
          </StatusBadge>
        </span>
      </header>
      <Warnings report={report} />
      <div className="grid @3xl/sections:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4 p-5">
          <div className={cn('grid gap-1 rounded-lg px-5 py-4', look.box)}>
            <span className={cn('text-body-sm font-medium', look.tone)}>{look.label}</span>
            <span
              className={cn(
                'text-display leading-tight font-semibold tracking-tight tabular-nums',
                look.amount,
              )}
            >
              <span className="mr-1.5 text-title-sm font-medium text-muted-foreground">CHF</span>
              {formatAmount(result.amount)}
            </span>
            <span className="text-caption text-muted-foreground">
              {translate('ziffer')}
              {result.ziffer} · {look.note}
            </span>
          </div>
          <dl className="grid gap-2 text-body-sm">
            {taxDue !== undefined && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {translate('taxDue2')}
                  <span className="text-caption">· 399</span>
                </dt>
                <dd className="tabular-nums">{formatAmount(taxDue)}</dd>
              </div>
            )}
            {inputTax !== undefined && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {translate('lessInputTax')}
                  <span className="text-caption">· 479</span>
                </dt>
                <dd className="tabular-nums">
                  {Number(inputTax) > 0 && '− '}
                  {formatAmount(inputTax)}
                </dd>
              </div>
            )}
          </dl>
          <Button variant="outline" size="sm" className="justify-self-start" onClick={onDetails}>
            {translate('allFiguresByZiffer')}
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <div className="grid content-start gap-3 border-t border-border/60 p-5 @3xl/sections:border-t-0 @3xl/sections:border-l">
          <h3 className="text-body-sm font-medium">{translate('howToFile')}</h3>
          <ol className="grid gap-3 text-body-sm text-pretty text-muted-foreground">
            <FileStep n={1}>{translate('checkTheFiguresAndCloseThePeriodSMonths')}</FileStep>
            <FileStep n={2}>
              <span className="grid justify-items-start gap-2">
                {translate('downloadTheESTVFile')}
                <ExportButtons
                  period={report.period}
                  exporting={exporting}
                  onEstv={() => onEstv(report.period)}
                />
              </span>
            </FileStep>
            <FileStep n={3}>
              {translate('inTheESTVEPortalOpenMWSTAbrechnungProImport')}
              {formatDate(dueBy(report.to))}.
            </FileStep>
          </ol>
        </div>
      </div>
    </section>
  )
}

function ClosedBadge({ report }: { report: VATReturn }) {
  const allClosed = report.closed_months === report.months
  return (
    <span className="flex items-center gap-1">
      <StatusBadge tone={allClosed ? 'green' : 'amber'}>
        {report.closed_months}
        {translate('of5')}
        {report.months}
        {translate('monthsClosed')}
      </StatusBadge>
      <HelpTip label={translate('aboutClosedMonths')}>
        {translate('closeTheMonthsOfThePeriodUnderSettingsClosing')}
      </HelpTip>
    </span>
  )
}

function Warnings({ report }: { report: VATReturn }) {
  if (report.warnings.length === 0) return null
  return (
    <ul
      className="grid gap-2 border-b border-border/60 bg-warning-surface px-5 py-3"
      aria-label={translate('warnings')}
    >
      {report.warnings.map((warning) => (
        <li key={warning.code} className="flex gap-2 text-body-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {warning.message}
            {warning.refs.length > 0 && <span> ({warning.refs.join(', ')})</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The ESTV file first (what gets filed), the PDF and CSV behind "More". */
function ExportButtons({
  period,
  exporting,
  onEstv,
}: {
  period: string
  exporting: boolean
  onEstv: () => void
}) {
  return (
    <span className="flex flex-wrap gap-2">
      <Button size="sm" disabled={exporting} onClick={onEstv}>
        <FileCode2 aria-hidden />{' '}
        {exporting ? translate('exporting') : translate('exportESTVFileXML')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {translate('moreExports')}
            <ChevronDown aria-hidden className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuItem asChild>
            <a href={localizedHref(vatReturnFileUrl(period, 'pdf'))} download>
              <FileText />
              {translate('pdfSummary')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={localizedHref(vatReturnFileUrl(period, 'csv'))} download>
              <SheetIcon /> CSV
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

const PERIOD_RESULT = {
  payable: { label: translate('payable'), tone: 'text-foreground' },
  refund: { label: translate('refund2'), tone: 'text-success' },
  zero: { label: translate('nothingToPay'), tone: 'text-muted-foreground' },
} as const

/** Every ended period as a row: its dates, how many of its months are closed and its result. */
function PeriodList({
  periods,
  onOpen,
}: {
  periods: { period: string; report: VATReturn | undefined }[]
  onOpen: (period: string) => void
}) {
  return (
    <section aria-labelledby="vat-periods-title" className={cn(card, 'overflow-hidden')}>
      <header className="border-b border-border/60 px-5 py-3.5">
        <h2 id="vat-periods-title" className="text-body font-semibold">
          {translate('periods')}
        </h2>
        <p className="text-body-sm text-muted-foreground">
          {translate('openOneForAllItsFiguresTheLinesTo')}
        </p>
      </header>
      <ul aria-label={translate('periods')} className="divide-y divide-border/60">
        {periods.map(({ period, report }) => {
          const result = report && resultOf(report)
          const look = result && PERIOD_RESULT[result.state]
          return (
            <li key={period}>
              <button
                type="button"
                onClick={() => onOpen(period)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-4 gap-y-1 px-5 py-3 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/60 @2xl/sections:grid-cols-[8rem_minmax(0,1fr)_auto_minmax(9rem,auto)_1rem]"
              >
                <span className="text-body font-medium tabular-nums">{period}</span>
                <span className="col-start-1 text-body-sm text-muted-foreground @2xl/sections:col-start-auto">
                  {report ? `${formatDate(report.from)} – ${formatDate(report.to)}` : ' '}
                </span>
                <span className="col-start-2 row-span-2 row-start-1 grid justify-items-end gap-1 @2xl/sections:col-start-auto @2xl/sections:row-span-1 @2xl/sections:row-start-auto @2xl/sections:contents">
                  <span className="@2xl/sections:justify-self-start">
                    {report ? (
                      <StatusBadge
                        tone={report.closed_months === report.months ? 'green' : 'amber'}
                      >
                        {report.closed_months}
                        {translate('of5')}
                        {report.months}
                        {translate('closed4')}
                      </StatusBadge>
                    ) : null}
                  </span>
                  <span className="text-right text-body-sm tabular-nums">
                    {result && look ? (
                      result.state === 'zero' ? (
                        <span className={look.tone}>{look.label}</span>
                      ) : (
                        <span className={look.tone}>
                          CHF {formatAmount(result.amount)}{' '}
                          <span className="text-muted-foreground">{look.label}</span>
                        </span>
                      )
                    ) : null}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="col-start-3 row-span-2 row-start-1 size-4 text-muted-foreground @2xl/sections:col-start-auto @2xl/sections:row-span-1 @2xl/sections:row-start-auto"
                />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** One period in full: every Ziffer, the lines to fill in yourself, and its exports. */
function PeriodDrawer({
  period,
  report,
  onClose,
  exporting,
  onEstv,
}: {
  period: string
  report: VATReturn | undefined
  onClose: () => void
  exporting: boolean
  onEstv: (period: string) => void
}) {
  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className={drawer}>
        <SheetHeader className="border-b border-border/60">
          <SheetTitle className="text-body font-medium">
            {translate('vatReturn3')}
            {period}
          </SheetTitle>
          <SheetDescription className="text-body-sm">
            {report
              ? `${formatDate(report.from)} – ${formatDate(report.to)} · ${METHODS[report.method]} · ${BASES[report.basis]}`
              : translate('loadingTheFigures')}
          </SheetDescription>
        </SheetHeader>
        {report ? (
          <>
            <div className="min-h-0 flex-1 overflow-auto">
              <ReturnFigures report={report} />
            </div>
            <SheetFooter className="flex-row flex-wrap items-center justify-between border-t border-border/60">
              <ExportButtons period={period} exporting={exporting} onEstv={() => onEstv(period)} />
              <Button variant="ghost" onClick={onClose}>
                {translate('close')}
              </Button>
            </SheetFooter>
          </>
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Why the ESTV file was refused; a missing UID is fixed in the invoice settings' VAT section. */
export function ExportBlockersDialog({
  reasons,
  onClose,
}: {
  reasons: ExportReason[]
  onClose: () => void
}) {
  const vat = settingsFix('seller.vat_number')
  const fixes = reasons.map((reason) => ({
    key: `${reason.code}:${reason.message}`,
    messages: [reason.message],
    action: reason.code === 'uid_missing' && <FixLink href={vat.href}>{vat.label}</FixLink>,
  }))
  return (
    <FixDialog
      title={translate('canTExportTheESTVFileYet')}
      description={translate('noFileWasMadeFixTheseThenExportAgain')}
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {translate('close')}
        </Button>
      }
    >
      <FixList title={fixCount(fixes.length, 'exporting')} fixes={fixes} />
    </FixDialog>
  )
}

const amountOf = (report: VATReturn, ziffer: string) =>
  report.lines.find((line) => line.ziffer === ziffer)?.amount

/** Payable, refund or nothing: what the summary's hero says and how it is tinted. */
export function resultOf(report: VATReturn) {
  const refund = amountOf(report, '510') ?? '0.00'
  const payable = amountOf(report, '500') ?? '0.00'
  if (Number(refund) > 0) return { state: 'refund', amount: refund, ziffer: '510' } as const
  if (Number(payable) > 0) return { state: 'payable', amount: payable, ziffer: '500' } as const
  return { state: 'zero', amount: '0.00', ziffer: '500' } as const
}

const RESULTS = {
  payable: {
    label: translate('vatPayable'),
    note: translate('zuBezahlenderBetrag'),
    box: 'bg-warning-surface',
    tone: 'text-warning',
    amount: '',
  },
  refund: {
    label: translate('vatRefund'),
    note: translate('guthabenDerSteuerpflichtigenPerson'),
    box: 'bg-success-surface',
    tone: 'text-success',
    amount: 'text-success',
  },
  zero: {
    label: translate('nothingToPay'),
    note: translate('zuBezahlenderBetrag'),
    box: 'bg-muted',
    tone: 'text-muted-foreground',
    amount: 'text-muted-foreground',
  },
} as const

function FileStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-semibold text-foreground tabular-nums"
      >
        {n}
      </span>
      <span className="min-w-0 pt-px">{children}</span>
    </li>
  )
}

const SECTIONS = [
  { title: translate('turnover'), below: 220 },
  { title: translate('deductions'), below: 300 },
  { title: translate('taxDue'), below: 400 },
  { title: translate('inputTax'), below: 500 },
  { title: translate('payableOrRefund'), below: 900 },
  { title: translate('otherCashFlows'), below: Infinity },
]

/** The lines in the form's sections; a line without a Ziffer stays in the section before it. */
export function sectionsOf(lines: VATReturnLine[]) {
  const groups = SECTIONS.map((section) => ({ ...section, lines: [] as VATReturnLine[] }))
  let index = 0
  for (const line of lines) {
    if (line.ziffer)
      index = Math.max(
        index,
        SECTIONS.findIndex((section) => Number(line.ziffer) < section.below),
      )
    groups[index]?.lines.push(line)
  }
  return groups.filter((group) => group.lines.length > 0)
}

/** Every line of the return by the form's sections; the drawer's title names the period. */
export function ReturnFigures({ report }: { report: VATReturn }) {
  return (
    <section aria-label={translate('vatReturn2', { period: report.period })}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-5 py-3">
        <ClosedBadge report={report} />
      </div>
      <Warnings report={report} />
      <div className="flex justify-between px-5 pt-3 text-caption font-medium text-muted-foreground">
        <span>{translate('zifferItem')}</span>
        <span>CHF</span>
      </div>
      {sectionsOf(report.lines).map((section) => (
        <FigureSection key={section.title} title={section.title} lines={section.lines} />
      ))}
    </section>
  )
}

function FigureSection({ title, lines }: { title: string; lines: VATReturnLine[] }) {
  const recorded = lines.filter((line) => line.tracked && line.kind !== 'total')
  const untracked = lines.filter((line) => !line.tracked)
  const totals = lines.filter((line) => line.tracked && line.kind === 'total')
  const id = `vat-section-${title.toLowerCase().replaceAll(' ', '-')}`
  return (
    <section aria-labelledby={id} className="pt-4 last:pb-2">
      <h3 id={id} className="px-5 pb-1 text-body-sm font-semibold tracking-tight">
        {title}
      </h3>
      <ul>
        {recorded.map((line) => (
          <FigureRow key={line.ziffer || line.label_en} line={line} />
        ))}
      </ul>
      {untracked.length > 0 && (
        // Lines Helvetly can't fill: a distinct box, so they read as "yours to check" and not as zeros.
        <Disclosure
          className="mx-5 my-2"
          icon={PencilLine}
          label={translate('linesToFillInYourself')}
          count={untracked.length}
          description={translate('notRecordedInHelvetlyAddThemInTheEPortal')}
        >
          <ul>
            {untracked.map((line) => (
              <FigureRow key={line.ziffer || line.label_en} line={line} />
            ))}
          </ul>
        </Disclosure>
      )}
      <ul>
        {totals.map((line) => (
          <FigureRow key={line.ziffer || line.label_en} line={line} />
        ))}
      </ul>
    </section>
  )
}

function FigureRow({ line }: { line: VATReturnLine }) {
  const total = line.kind === 'total'
  return (
    <li
      className={cn(
        'grid grid-cols-[2.75rem_minmax(0,1fr)_auto] gap-x-3 px-5 py-2',
        total && 'mt-1 border-t border-border/60 bg-muted/40 font-semibold',
      )}
    >
      <span className="text-body-sm text-muted-foreground tabular-nums">{line.ziffer}</span>
      <span className="grid gap-0.5">
        <span className="text-body text-pretty">{line.label_en}</span>
        <span className="text-caption font-normal text-muted-foreground">{line.label_de}</span>
      </span>
      <span className="text-right text-body whitespace-nowrap tabular-nums">
        {line.kind === 'rate' ? (
          <>
            <span className="block">{formatAmount(line.tax)}</span>
            <span className="block text-caption text-muted-foreground">
              {formatAmount(line.base)}
              {translate('at')}
              {line.rate}%
            </span>
          </>
        ) : line.tracked ? (
          formatAmount(line.amount)
        ) : (
          <span className="text-muted-foreground" title={translate('notRecordedInHelvetly')}>
            —
          </span>
        )}
      </span>
    </li>
  )
}

/** How VAT is settled with the ESTV: the method, the period length, the basis and, for the net tax rate method, the approved rates. */
function SettleDrawer({ settings, onClose }: { settings: VATReturnSettings; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(() => withKeys(settings))
  const [errors, setErrors] = useState<FieldErrors>({})
  const save = useMutation({
    mutationFn: async () => (await vatReturnApi.saveSettings(withoutKeys(draft))).data,
    onSuccess: async (data) => {
      queryClient.setQueryData(SETTINGS_KEY, data)
      await queryClient.invalidateQueries({ queryKey: ['vat-return', 'report'] })
      toast.success(translate('vatSettingsSaved'))
      onClose()
    },
    onError: (error) => {
      const fields = apiFieldErrors(error)
      if (fields) setErrors(fields)
      else toast.error(errorMessage(error))
    },
  })
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const setRate = (key: string, patch: Partial<RateRow>) =>
    set({ net_rates: draft.net_rates.map((r) => (r.key === key ? { ...r, ...patch } : r)) })
  const rateError = Object.entries(errors).find(([key]) => key.startsWith('net_rates'))?.[1]

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className={cn(drawer, 'sm:w-[min(520px,100vw)]!')}>
        <SheetHeader className="border-b border-border/60">
          <SheetTitle className="text-body font-medium">{translate('howYouSettleVAT')}</SheetTitle>
          <SheetDescription className="text-body-sm">
            {translate('asRegisteredWithTheESTVTheseDecideHowEvery')}
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            setErrors({})
            save.mutate()
          }}
        >
          <fieldset
            disabled={save.isPending}
            className="grid min-h-0 flex-1 content-start gap-5 overflow-auto p-4"
          >
            <FormField id="vat-method" required label={translate('method')} error={errors.method}>
              <NativeSelect
                id="vat-method"
                value={draft.method}
                onChange={(event) => {
                  const value = event.target.value
                  if (isKey(METHODS, value)) set({ method: value })
                }}
              >
                {Object.entries(METHODS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="vat-period"
                required
                label={translate('returnPeriod')}
                error={errors.period}
              >
                <NativeSelect
                  id="vat-period"
                  value={draft.period}
                  onChange={(event) => {
                    const value = event.target.value
                    if (isKey(LENGTHS, value)) set({ period: value })
                  }}
                >
                  {Object.entries(LENGTHS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="vat-basis" required label={translate('basis')} error={errors.basis}>
                <NativeSelect
                  id="vat-basis"
                  value={draft.basis}
                  onChange={(event) => {
                    const value = event.target.value
                    if (isKey(BASES, value)) set({ basis: value })
                  }}
                >
                  {Object.entries(BASES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>
            {draft.method === 'net_tax_rate' && (
              <fieldset
                className="grid gap-3 border-t border-border/60 pt-5"
                aria-labelledby="vat-net-rates"
              >
                <div className="grid gap-0.5">
                  <p id="vat-net-rates" className="text-body font-medium">
                    {translate('approvedNetTaxRates')}
                  </p>
                  <p className="text-body-sm text-muted-foreground">
                    {translate('theRatesInTheESTVSApprovalOnePer')}
                  </p>
                </div>
                {draft.net_rates.map((rate, index) => (
                  <div
                    key={rate.key}
                    className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2"
                  >
                    <FormField
                      id={`net-rate-label-${index}`}
                      label={translate('activity', { value1: index + 1 })}
                    >
                      <Input
                        id={`net-rate-label-${index}`}
                        value={rate.label}
                        onChange={(event) => setRate(rate.key, { label: event.target.value })}
                      />
                    </FormField>
                    <FormField id={`net-rate-${index}`} label={translate('rate2')}>
                      <UnitInput
                        id={`net-rate-${index}`}
                        unit="%"
                        inputMode="decimal"
                        value={rate.rate}
                        onChange={(event) => setRate(rate.key, { rate: event.target.value })}
                      />
                    </FormField>
                    <Button
                      type="button"
                      variant="destructive-ghost"
                      size="icon"
                      aria-label={translate('removeActivity', { value1: index + 1 })}
                      onClick={() =>
                        set({ net_rates: draft.net_rates.filter((r) => r.key !== rate.key) })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() =>
                    set({
                      net_rates: [
                        ...draft.net_rates,
                        { label: '', rate: '', key: `rate-${++rowCount}` },
                      ],
                    })
                  }
                >
                  <Plus />
                  {translate('addARate')}
                </Button>
                {rateError && <InlineError>{rateError}</InlineError>}
              </fieldset>
            )}
          </fieldset>
          <SheetFooter className="flex-row justify-end border-t border-border/60">
            <Button type="button" variant="outline" onClick={onClose}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? translate('saving') : translate('save2')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

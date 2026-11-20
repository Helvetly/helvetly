'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@helvetly/ui/components/input-group'
import { Panel } from '@helvetly/ui/components/panel'
import { byDay, formatDay } from '@helvetly/ui/lib/days'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ClipboardList,
  Download,
  Lock,
  MessageSquareQuote,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/clients/fields'
import { Initials } from '@/components/initials'
import { RecordLink } from '@/components/record-link'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { ApiError, errorMessage } from '@/lib/api'
import {
  createEntry,
  deleteEntry,
  entriesExportUrl,
  periodLabel,
  updateEntry,
  type Engagement,
  type Entry,
  type EntryInput,
  type Period,
  type PeriodSummary,
} from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { useMembers } from '@/lib/members'
import { queryKeys } from '@/lib/queries'
import { todayIn } from '@/lib/timezone'

import { plain, sumQuantities, Tip, unitShort, withUnit } from './engagement-bits'
import { entryDateBounds, entryDateProblem } from './entry-date'

/** The API's refusals, in words for the person: a 422 says what is wrong with which field, never just "check the fields". */
export function friendlyError(error: unknown): string {
  const fields = apiFieldErrors(error)
  if (fields && Object.keys(fields).length > 0) return Object.values(fields).join(' ')
  if (error instanceof ApiError) {
    if (error.code === 'entry_invoiced') return translate('thisEntryIsOnAnInvoiceDeleteTheDraft')
    if (error.code === 'already_invoiced') return translate('thisPeriodAlreadyHasAnUpfrontInvoice')
    if (error.code === 'nothing_to_invoice')
      return translate('thereIsNothingToInvoiceForThisPeriodYet')
    if (error.code === 'period_invoiced') return translate('thisPeriodIsAlreadyInvoiced')
  }
  return errorMessage(error)
}

export const today = () => todayIn()

// Display only: the server decides; thousandths avoid float noise.
const milli = (value: string) => Math.round(Number(value) * 1000)

export function useRefreshEngagement() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.engagements })
    void queryClient.invalidateQueries({ queryKey: ['invoices'] })
  }
}

/** The fields the quick form shows a server refusal under. */
const QUICK_LOG_FIELDS = ['quantity', 'date', 'performed_by', 'note', 'client_performance'] as const

/**
 * Date, quantity, note, client performance, who: Enter logs it and puts the cursor back on quantity. The engagement's
 * detail and its list row's "Log delivery" dialog both use this one form.
 */
export function QuickLog({
  engagement,
  current,
  onLogged,
}: {
  engagement: Pick<
    Engagement,
    'id' | 'unit' | 'start_date' | 'end_date' | 'cancelled_on' | 'invoice_detail'
  >
  current: PeriodSummary | null
  /** Called after a save; without it the form stays for the next entry. */
  onLogged?: () => void
}) {
  const { id: engagementId, unit } = engagement
  const refresh = useRefreshEngagement()
  const members = useMembers()
  const bounds = entryDateBounds(engagement, today())
  // A form opened on an engagement that starts later than today, or ended, starts on a day it accepts.
  const [date, setDate] = useState(() => (bounds.max < bounds.min ? bounds.min : bounds.max))
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [performance, setPerformance] = useState('')
  const [onInvoice, setOnInvoice] = useState(false)
  const [by, setBy] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const quantityRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)

  const amount = milli(quantity)
  const over =
    current && date >= current.starts_on && date <= current.ends_on && amount > 0
      ? amount - milli(current.remaining)
      : 0

  const save = useMutation({
    mutationFn: () =>
      createEntry(engagementId, {
        date,
        quantity,
        note: note.trim() || null,
        client_performance: performance.trim() || null,
        client_performance_on_invoice: onInvoice && performance.trim() !== '',
        ...(by ? { performed_by: by } : {}),
      }),
    onSuccess: ({ data }) => {
      setQuantity('')
      setNote('')
      setPerformance('')
      setOnInvoice(false)
      setErrors({})
      refresh()
      if (onLogged) onLogged()
      else quantityRef.current?.focus()
      toast.success(
        translate('logged', { quantity: data.entry.quantity, value2: unit ? ` ${unit}` : '' }),
        {
          action: {
            label: translate('undo'),
            onClick: () =>
              void deleteEntry(engagementId, data.entry.id).then(refresh, (error: unknown) =>
                toast.error(friendlyError(error)),
              ),
          },
        },
      )
    },
    onError: (error: unknown) => {
      const fields = apiFieldErrors(error) ?? {}
      const shown = QUICK_LOG_FIELDS.filter((field) => fields[field])
      setErrors(Object.fromEntries(shown.map((field) => [field, fields[field]])))
      if (shown.includes('date')) dateRef.current?.focus()
      else if (shown.length > 0) quantityRef.current?.focus()
      // A refusal that names no field here still says why.
      if (shown.length === 0) toast.error(friendlyError(error))
    },
  })

  const submit = () => {
    if (amount <= 0 || save.isPending) return
    const problem = entryDateProblem(date, bounds)
    if (problem) {
      setErrors({ date: problem })
      dateRef.current?.focus()
      return
    }
    save.mutate()
  }

  const id = useId()
  const label = 'text-caption font-medium text-muted-foreground'
  const invalid = (field: (typeof QUICK_LOG_FIELDS)[number]) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `${id}-${field}-error` } : {}
  const errorText = (field: (typeof QUICK_LOG_FIELDS)[number]) =>
    errors[field] && (
      <p id={`${id}-${field}-error`} className="text-caption text-destructive">
        {errors[field]}
      </p>
    )
  const clear = (field: (typeof QUICK_LOG_FIELDS)[number]) =>
    errors[field] && setErrors((shown) => ({ ...shown, [field]: undefined }))
  return (
    <form
      className="grid gap-3"
      // The form's own messages say which day to pick; the browser's bubble would only say "too early".
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_9.5rem_minmax(0,1fr)]">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-qty`} className={label}>
            {translate('quantity')}
          </label>
          <InputGroup>
            <InputGroupInput
              ref={quantityRef}
              id={`${id}-qty`}
              aria-label={translate('quantity')}
              inputMode="decimal"
              placeholder="0"
              className="tabular-nums"
              value={quantity}
              {...invalid('quantity')}
              onChange={(event) => {
                clear('quantity')
                setQuantity(event.target.value.replace(',', '.'))
              }}
            />
            {unit && (
              <InputGroupAddon align="inline-end">
                <InputGroupText>{unit}</InputGroupText>
              </InputGroupAddon>
            )}
          </InputGroup>
          {errorText('quantity')}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-date`} className={label}>
            {translate('date')}
          </label>
          <Input
            ref={dateRef}
            id={`${id}-date`}
            type="date"
            value={date}
            min={bounds.min}
            max={bounds.max}
            {...invalid('date')}
            onChange={(event) => {
              clear('date')
              setDate(event.target.value)
            }}
          />
          {errorText('date')}
        </div>
        <div className="grid gap-1.5 max-sm:col-span-2">
          <label htmlFor={`${id}-by`} className={label}>
            {translate('performedBy')}
          </label>
          <NativeSelect
            id={`${id}-by`}
            value={by}
            {...invalid('performed_by')}
            onChange={(event) => {
              clear('performed_by')
              setBy(event.target.value)
            }}
            className="h-8"
          >
            <option value="">{translate('me')}</option>
            {members.data
              ?.filter((m) => !m.is_you)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
          </NativeSelect>
          {errorText('performed_by')}
        </div>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-note`} className={label}>
          {translate('note')}{' '}
          <span className="font-normal text-placeholder">
            {translate('optionalShownOnPerEntryInvoiceLines')}
          </span>
        </label>
        <Input
          id={`${id}-note`}
          aria-label={translate('note')}
          placeholder={translate('whatWasDone')}
          maxLength={500}
          value={note}
          {...invalid('note')}
          onChange={(event) => {
            clear('note')
            setNote(event.target.value)
          }}
        />
        {errorText('note')}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-performance`} className={label}>
          {translate('clientPerformance')}{' '}
          <span className="font-normal text-placeholder">
            {translate('optionalTheClientSeesItInThePortal')}
          </span>
        </label>
        <Input
          id={`${id}-performance`}
          aria-label={translate('clientPerformance')}
          placeholder={translate('howDidTheClientDo')}
          maxLength={500}
          value={performance}
          onChange={(event) => setPerformance(event.target.value)}
        />
        {errorText('client_performance')}
        <ShowOnInvoice
          checked={onInvoice}
          onChange={setOnInvoice}
          perEntry={engagement.invoice_detail === 'per_entry'}
          hasText={performance.trim() !== ''}
        />
      </div>
      <div className="flex min-h-8 items-center gap-3">
        {over > 0 ? (
          <output className="flex min-w-0 items-center gap-1.5 text-body-sm text-warning">
            <TriangleAlert className="size-3.5 shrink-0" />
            {(over / 1000).toString()}
            {translate('overWhatIsLeftItWillBeSavedAs')}
          </output>
        ) : (
          <p className="text-body-sm text-muted-foreground max-sm:hidden">
            {translate('pressEnterToLog')}
          </p>
        )}
        <Button type="submit" className="ml-auto" disabled={amount <= 0 || save.isPending}>
          <Plus />
          {amount > 0
            ? translate('log2', { quantity: quantity, value2: unit ? ` ${unit}` : '' })
            : translate('log')}
        </Button>
      </div>
    </form>
  )
}

/**
 * Whether the client performance is added to the entry's own invoice line. Only an engagement invoiced with a line per
 * entry has such a line, so the choice is not shown otherwise; only a written performance can go on it.
 * A stored choice is kept as it is, since one period may still be invoiced per entry from the period menu.
 */
function ShowOnInvoice({
  checked,
  onChange,
  perEntry,
  hasText,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  perEntry: boolean
  hasText: boolean
}) {
  if (!perEntry) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-body-sm text-muted-foreground">
      <label className={cn('flex items-center gap-2', !hasText && 'opacity-60')}>
        <Checkbox
          checked={hasText && checked}
          disabled={!hasText}
          onCheckedChange={(on) => onChange(on === true)}
        />
        {translate('alsoPrintOnTheInvoiceLine')}
      </label>
      <HelpTip label={translate('alsoPrintOnTheInvoiceLine')}>
        {translate('theClientPerformanceIsAddedToThisEntrysInvoiceLine')}
      </HelpTip>
    </span>
  )
}

function EntryRow({
  engagementId,
  entry,
  unit,
  writable,
  perEntry,
}: {
  engagementId: string
  entry: Entry
  unit: Engagement['unit']
  writable: boolean
  perEntry: boolean
}) {
  const refresh = useRefreshEngagement()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    date: entry.date,
    quantity: entry.quantity,
    note: entry.note ?? '',
    client_performance: entry.client_performance ?? '',
    client_performance_on_invoice: entry.client_performance_on_invoice,
  })
  const [confirming, setConfirming] = useState(false)

  const save = useMutation({
    mutationFn: (input: Partial<EntryInput>) => updateEntry(engagementId, entry.id, input),
    onSuccess: () => {
      setEditing(false)
      refresh()
    },
    onError: (error: unknown) => toast.error(friendlyError(error)),
  })
  const remove = useMutation({
    mutationFn: () => deleteEntry(engagementId, entry.id),
    onSuccess: () => {
      toast.success(translate('entryDeleted'))
      refresh()
    },
    onError: (error: unknown) => toast.error(friendlyError(error)),
  })
  const commit = () =>
    save.mutate({
      date: draft.date,
      quantity: draft.quantity,
      note: draft.note.trim() || null,
      client_performance: draft.client_performance.trim() || null,
      client_performance_on_invoice:
        draft.client_performance_on_invoice && draft.client_performance.trim() !== '',
    })

  if (editing)
    return (
      <li className="py-2">
        <form
          className="grid grid-cols-[9.5rem_5.5rem_minmax(0,1fr)_auto] items-center gap-2 max-sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            commit()
          }}
        >
          <Input
            type="date"
            aria-label={translate('date')}
            value={draft.date}
            max={today()}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
          <Input
            aria-label={translate('quantity')}
            inputMode="decimal"
            className="tabular-nums"
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value.replace(',', '.') })}
          />
          <Input
            aria-label={translate('note')}
            maxLength={500}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
          <div className="flex gap-1">
            <Tip label={translate('save2')}>
              <Button
                size="icon-sm"
                type="submit"
                aria-label={translate('saveEntry')}
                disabled={save.isPending}
              >
                <Check />
              </Button>
            </Tip>
            <Tip label={translate('cancel')}>
              <Button
                size="icon-sm"
                variant="ghost"
                type="button"
                aria-label={translate('cancelEditing')}
                onClick={() => setEditing(false)}
              >
                <X />
              </Button>
            </Tip>
          </div>
          <div className="col-span-full flex items-center gap-3">
            <Input
              aria-label={translate('clientPerformance')}
              placeholder={translate('howDidTheClientDo')}
              className="min-w-0 flex-1"
              maxLength={500}
              value={draft.client_performance}
              onChange={(e) => setDraft({ ...draft, client_performance: e.target.value })}
            />
            <ShowOnInvoice
              checked={draft.client_performance_on_invoice}
              onChange={(on) => setDraft({ ...draft, client_performance_on_invoice: on })}
              perEntry={perEntry}
              hasText={draft.client_performance.trim() !== ''}
            />
          </div>
        </form>
      </li>
    )

  const short = unitShort(unit)
  return (
    <li
      className={cn(
        'group/entry grid min-h-11 items-start gap-x-3 py-2',
        writable ? 'grid-cols-[minmax(0,1fr)_auto_3.25rem]' : 'grid-cols-[minmax(0,1fr)_auto]',
      )}
    >
      <div className="grid min-w-0 gap-1">
        <p className={cn('line-clamp-2 text-body', !entry.note && 'text-muted-foreground italic')}>
          {entry.note || translate('noNote')}
        </p>
        {entry.client_performance && (
          <div className="flex items-start gap-1.5 border-l-2 pl-2 text-body-sm text-muted-foreground">
            <MessageSquareQuote aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <p className="line-clamp-3 min-w-0">
              <span className="font-medium text-foreground/80">
                {translate('clientPerformance')}
              </span>
              <span className="sr-only">:</span> {entry.client_performance}
              {perEntry && entry.client_performance_on_invoice && (
                <span className="ml-1.5 inline-flex align-middle">
                  <Badge size="sm">{translate('onInvoice')}</Badge>
                </span>
              )}
            </p>
          </div>
        )}
        {(entry.performed_by || entry.invoice) && (
          <p className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
            {entry.performed_by && (
              <Tip label={entry.performed_by.name}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Initials name={entry.performed_by.name} className="size-5" />
                  <span className="max-w-40 truncate">{entry.performed_by.name}</span>
                </span>
              </Tip>
            )}
            {entry.performed_by && entry.invoice && <span aria-hidden>·</span>}
            {entry.invoice && (
              <RecordLink
                href={`/invoices?id=${encodeURIComponent(entry.invoice.id)}`}
                className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
              >
                <Lock className="size-3" aria-hidden />
                {translate('invoice')}
                {entry.invoice.number ?? 'draft'}
              </RecordLink>
            )}
          </p>
        )}
      </div>
      {confirming ? (
        <span className="col-span-2 flex items-center justify-end gap-1">
          <Button size="xs" variant="destructive" onClick={() => remove.mutate()}>
            <Trash2 />
            {translate('delete')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
            {translate('keep')}
          </Button>
        </span>
      ) : (
        <span className="text-right text-body leading-6 font-medium whitespace-nowrap tabular-nums">
          {plain(entry.quantity)}
          {short && <span className="ml-1 font-normal text-muted-foreground">{short}</span>}
        </span>
      )}
      {confirming || !writable ? null : entry.invoice ? (
        <span aria-hidden />
      ) : (
        <span className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/entry:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
          <Tip label={translate('editEntry')}>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={translate('editEntry')}
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
          </Tip>
          <Tip label={translate('deleteEntry')}>
            <Button
              size="icon-xs"
              variant="destructive-ghost"
              aria-label={translate('deleteEntry')}
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
            </Button>
          </Tip>
        </span>
      )}
    </li>
  )
}

/** Entries grouped by period, each with its count and total; Export CSV in the header. */
export function EntriesPanel({
  engagementId,
  entries,
  periods,
  unit,
  writable,
  perEntry,
}: {
  engagementId: string
  entries: Entry[]
  periods: Period[]
  unit: Engagement['unit']
  writable: boolean
  /** The engagement invoices a line per entry, the only lines a client performance can be printed on. */
  perEntry: boolean
}) {
  const groups = periods
    .map((period) => ({ period, rows: entries.filter((entry) => entry.period_id === period.id) }))
    .filter((group) => group.rows.length > 0)
  return (
    <Panel
      title={translate('entries')}
      action={
        entries.length > 0 && (
          <Button asChild size="xs" variant="ghost" className="-mr-1.5 text-muted-foreground">
            <a href={localizedHref(entriesExportUrl(engagementId))} download>
              <Download />
              {translate('exportCSV')}
            </a>
          </Button>
        )
      }
    >
      {groups.length === 0 ? (
        <div className="flex items-center gap-3 py-3 text-body-sm text-muted-foreground">
          <ClipboardList className="size-4 shrink-0" aria-hidden />
          <p>
            {translate('nothingLoggedYet')}
            {writable && translate('whatYouLogAboveShowsUpHereGroupedBy')}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {groups.map(({ period, rows }) => (
            <section key={period.id} aria-label={periodLabel(period)}>
              <header className="flex items-baseline justify-between gap-3 border-b pb-1.5 text-caption text-muted-foreground">
                <h4 className="text-body-sm text-foreground">{periodLabel(period)}</h4>
                <span className="tabular-nums">
                  {rows.length} {rows.length === 1 ? 'entry' : 'entries'} ·{' '}
                  <span className="font-medium text-foreground">
                    {withUnit(sumQuantities(rows.map((row) => row.quantity)), unit)}
                  </span>
                </span>
              </header>
              <ol className="divide-y divide-border/60">
                {byDay(rows).map((day) => (
                  <li key={day.date} className="pt-2.5 pb-0.5">
                    <time
                      dateTime={day.date}
                      title={formatDate(day.date)}
                      className="text-body-sm font-medium tabular-nums"
                    >
                      {formatDay(day.date)}
                    </time>
                    <ul>
                      {day.items.map((entry) => (
                        <EntryRow
                          key={entry.id}
                          engagementId={engagementId}
                          entry={entry}
                          unit={unit}
                          writable={writable}
                          perEntry={perEntry}
                        />
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Panel>
  )
}

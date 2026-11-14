'use client'

import { Button } from '@helvetly/ui/components/button'
import { Input } from '@helvetly/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@helvetly/ui/components/input-group'
import { Panel } from '@helvetly/ui/components/panel'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ClipboardList,
  Download,
  Lock,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/clients/fields'
import { RecordLink } from '@/components/record-link'
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
} from '@/lib/engagements'
import { useMembers } from '@/lib/members'
import { queryKeys } from '@/lib/queries'
import { todayIn } from '@/lib/timezone'

import { plain, sumQuantities, Tip, unitShort, withUnit } from './engagement-bits'

/** The API's refusals, in words for the person. */
export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'entry_invoiced')
      return 'This entry is on an invoice. Delete the draft or void the invoice first.'
    if (error.code === 'already_invoiced') return 'This period already has an upfront invoice.'
    if (error.code === 'nothing_to_invoice')
      return 'There is nothing to invoice for this period yet.'
    if (error.code === 'period_invoiced') return 'This period is already invoiced.'
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

/** Date, quantity, note, who: Enter logs it and puts the cursor back on quantity. */
export function QuickLog({
  engagementId,
  unit,
  current,
}: {
  engagementId: string
  unit: string | null
  current: Period | null
}) {
  const refresh = useRefreshEngagement()
  const members = useMembers()
  const [date, setDate] = useState(today)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [by, setBy] = useState('')
  const quantityRef = useRef<HTMLInputElement>(null)

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
        ...(by ? { performed_by: by } : {}),
      }),
    onSuccess: ({ data }) => {
      setQuantity('')
      setNote('')
      refresh()
      quantityRef.current?.focus()
      toast.success(`Logged ${data.entry.quantity}${unit ? ` ${unit}` : ''}.`, {
        action: {
          label: 'Undo',
          onClick: () =>
            void deleteEntry(engagementId, data.entry.id).then(refresh, (error: unknown) =>
              toast.error(friendlyError(error)),
            ),
        },
      })
    },
    onError: (error: unknown) => toast.error(friendlyError(error)),
  })

  const submit = () => {
    if (amount > 0 && !save.isPending) save.mutate()
  }

  const id = useId()
  const label = 'text-caption font-medium text-muted-foreground'
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_9.5rem_minmax(0,1fr)]">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-qty`} className={label}>
            Quantity
          </label>
          <InputGroup>
            <InputGroupInput
              ref={quantityRef}
              id={`${id}-qty`}
              aria-label="Quantity"
              inputMode="decimal"
              placeholder="0"
              className="tabular-nums"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value.replace(',', '.'))}
            />
            {unit && (
              <InputGroupAddon align="inline-end">
                <InputGroupText>{unit}</InputGroupText>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-date`} className={label}>
            Date
          </label>
          <Input
            id={`${id}-date`}
            type="date"

            value={date}
            max={today()}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5 max-sm:col-span-2">
          <label htmlFor={`${id}-by`} className={label}>
            Performed by
          </label>
          <NativeSelect
            id={`${id}-by`}
            value={by}
            onChange={(event) => setBy(event.target.value)}
            className="h-8"
          >
            <option value="">Me</option>
            {members.data
              ?.filter((m) => !m.is_you)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-note`} className={label}>
          Note{' '}
          <span className="font-normal text-placeholder">
            · optional, shown on per-entry invoice lines
          </span>
        </label>
        <Input
          id={`${id}-note`}
          aria-label="Note"
          placeholder="What was done?"
          maxLength={500}

          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="flex min-h-8 items-center gap-3">
        {over > 0 ? (
          <output className="flex min-w-0 items-center gap-1.5 text-body-sm text-warning">
            <TriangleAlert className="size-3.5 shrink-0" />
            {(over / 1000).toString()} over what is left. It will be saved as overage.
          </output>
        ) : (
          <p className="text-body-sm text-muted-foreground max-sm:hidden">Press Enter to log.</p>
        )}
        <Button type="submit" className="ml-auto" disabled={amount <= 0 || save.isPending}>
          <Plus />
          {amount > 0 ? `Log ${quantity}${unit ? ` ${unit}` : ''}` : 'Log'}
        </Button>
      </div>
    </form>
  )
}

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

function EntryRow({
  engagementId,
  entry,
  unit,
  writable,
}: {
  engagementId: string
  entry: Entry
  unit: Engagement['unit']
  writable: boolean
}) {
  const refresh = useRefreshEngagement()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    date: entry.date,
    quantity: entry.quantity,
    note: entry.note ?? '',
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
      toast.success('Entry deleted.')
      refresh()
    },
    onError: (error: unknown) => toast.error(friendlyError(error)),
  })
  const commit = () =>
    save.mutate({ date: draft.date, quantity: draft.quantity, note: draft.note.trim() || null })

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
            aria-label="Date"
            value={draft.date}
            max={today()}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
          <Input
            aria-label="Quantity"
            inputMode="decimal"
            className="tabular-nums"
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value.replace(',', '.') })}
          />
          <Input
            aria-label="Note"
            maxLength={500}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
          <div className="flex gap-1">
            <Tip label="Save">
              <Button
                size="icon-sm"
                type="submit"
                aria-label="Save entry"
                disabled={save.isPending}
              >
                <Check />
              </Button>
            </Tip>
            <Tip label="Cancel">
              <Button
                size="icon-sm"
                variant="ghost"
                type="button"
                aria-label="Cancel editing"
                onClick={() => setEditing(false)}
              >
                <X />
              </Button>
            </Tip>
          </div>
        </form>
      </li>
    )

  const short = unitShort(unit)
  return (
    <li
      className={cn(
        'group/entry grid min-h-11 items-center gap-x-3 py-2',
        writable
          ? 'grid-cols-[3.75rem_minmax(0,1fr)_auto_3.25rem]'
          : 'grid-cols-[3.75rem_minmax(0,1fr)_auto]',
      )}
    >
      <time
        dateTime={entry.date}
        title={formatDate(entry.date)}
        className="text-body-sm whitespace-nowrap text-muted-foreground tabular-nums"
      >
        {dayMonth.format(new Date(entry.date))}
      </time>
      <div className="min-w-0">
        <p className={cn('line-clamp-2 text-body', !entry.note && 'text-muted-foreground')}>
          {entry.note || 'No note'}
        </p>
        {(entry.performed_by || entry.invoice) && (
          <p className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
            {entry.performed_by && <span className="truncate">{entry.performed_by.name}</span>}
            {entry.performed_by && entry.invoice && <span aria-hidden>·</span>}
            {entry.invoice && (
              <RecordLink
                href={`/invoices?id=${encodeURIComponent(entry.invoice.id)}`}
                className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
              >
                <Lock className="size-3" aria-hidden />
                Invoice {entry.invoice.number ?? 'draft'}
              </RecordLink>
            )}
          </p>
        )}
      </div>
      {confirming ? (
        <span className="col-span-2 flex items-center justify-end gap-1">
          <Button size="xs" variant="destructive" onClick={() => remove.mutate()}>
            <Trash2 /> Delete
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <span className="text-right text-body font-medium whitespace-nowrap tabular-nums">
          {plain(entry.quantity)}
          {short && <span className="ml-1 font-normal text-muted-foreground">{short}</span>}
        </span>
      )}
      {confirming || !writable ? null : entry.invoice ? (
        <span aria-hidden />
      ) : (
        <span className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/entry:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
          <Tip label="Edit entry">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Edit entry"
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
          </Tip>
          <Tip label="Delete entry">
            <Button
              size="icon-xs"
              variant="destructive-ghost"
              aria-label="Delete entry"
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
}: {
  engagementId: string
  entries: Entry[]
  periods: Period[]
  unit: Engagement['unit']
  writable: boolean
}) {
  const groups = periods
    .map((period) => ({ period, rows: entries.filter((entry) => entry.period_id === period.id) }))
    .filter((group) => group.rows.length > 0)
  return (
    <Panel
      title="Entries"
      action={
        entries.length > 0 && (
          <Button asChild size="xs" variant="ghost" className="-mr-1.5 text-muted-foreground">
            <a href={entriesExportUrl(engagementId)} download>
              <Download />
              Export CSV
            </a>
          </Button>
        )
      }
    >
      {groups.length === 0 ? (
        <div className="flex items-center gap-3 py-3 text-body-sm text-muted-foreground">
          <ClipboardList className="size-4 shrink-0" aria-hidden />
          <p>
            Nothing logged yet.
            {writable && ' What you log above shows up here, grouped by period.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {groups.map(({ period, rows }) => (
            <section key={period.id} aria-label={periodLabel(period)}>
              <header className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 text-caption text-muted-foreground">
                <h4 className="font-medium">{periodLabel(period)}</h4>
                <span className="tabular-nums">
                  {rows.length} {rows.length === 1 ? 'entry' : 'entries'} ·{' '}
                  <span className="font-medium text-foreground">
                    {withUnit(sumQuantities(rows.map((row) => row.quantity)), unit)}
                  </span>
                </span>
              </header>
              <ul className="divide-y divide-border/60">
                {rows.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    engagementId={engagementId}
                    entry={entry}
                    unit={unit}
                    writable={writable}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  )
}

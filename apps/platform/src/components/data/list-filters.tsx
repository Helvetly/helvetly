import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import { Input } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { ListFilter, X } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { addDays, today } from '@/lib/invoices'
import {
  changeFor,
  resolveValue,
  SINCE_PRESETS,
  type QueryField,
  type QueryOption,
} from '@/lib/list-query'

/** Date presets for a from–to filter, whole calendar ranges up to today in the workspace time zone. */
export function datePresets(day = today()) {
  const month = day.slice(0, 7)
  const startOfMonth = `${month}-01`
  const lastMonthEnd = addDays(startOfMonth, -1)
  const quarter = Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3 + 1
  return [
    { label: translate('thisMonth2'), from: startOfMonth, to: day },
    { label: translate('lastMonth'), from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    {
      label: translate('thisQuarter'),
      from: `${day.slice(0, 4)}-${String(quarter).padStart(2, '0')}-01`,
      to: day,
    },
    { label: translate('last90Days2'), from: addDays(day, -89), to: day },
    { label: translate('thisYear'), from: `${day.slice(0, 4)}-01-01`, to: day },
  ]
}

/** A "since" field's choices (`updated:30d`), for `values`. */
export const sinceOptions = (): QueryOption[] =>
  SINCE_PRESETS.map((preset) => ({
    value: preset,
    label: {
      '7d': translate('last7Days'),
      '30d': translate('last30Days'),
      year: translate('thisYear'),
    }[preset],
  }))

/** The popover's fields: those with a control, and the other ends of their date ranges. */
export function filterFields<P>(fields: readonly QueryField<P>[]) {
  const shown = fields.filter((field) => field.placeholder)
  const ends = new Set(shown.flatMap((field) => (field.until ? [field.until] : [])))
  return { shown, all: fields.filter((field) => field.placeholder || ends.has(field.id)) }
}

/** How many of the popover's controls are set (a date range counts once). */
export function activeFilters<P>(fields: readonly QueryField<P>[], params: P) {
  const byId = new Map(fields.map((field) => [field.id, field]))
  return filterFields(fields).shown.filter((field) => {
    const end = field.until ? byId.get(field.until) : undefined
    return field.get(params).length > 0 || (end?.get(params).length ?? 0) > 0
  }).length
}

type Props<P> = {
  fields: readonly QueryField<P>[]
  params: P
  onChange: (change: Partial<P>) => void
  /** Controls a field's options cannot make, by field id (a client picker). */
  custom?: Partial<Record<string, ReactNode>>
  variant?: 'ghost' | 'outline'
  align?: 'start' | 'end'
}

/**
 * The list's Filters popover, made from the same fields as the search's `field:value` terms, so a
 * chip typed in the search shows here and a choice here shows as a chip. Each control is named by
 * its placeholder; there are no label rows.
 */
export function ListFilters<P>({
  fields,
  params,
  onChange,
  custom,
  variant = 'ghost',
  align = 'start',
}: Props<P>) {
  const { shown, all } = filterFields(fields)
  const count = activeFilters(fields, params)
  const byId = new Map(fields.map((field) => [field.id, field]))
  const set = (field: QueryField<P>, values: string[]) => onChange(field.set(values, params))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          className={cn(
            'font-normal',
            variant === 'ghost' ? 'text-title-sm' : 'gap-1.5 text-foreground/80',
          )}
        >
          <ListFilter className="stroke-[1.5]" />
          <span className={cn(variant === 'outline' && 'max-lg:sr-only')}>
            {translate('filters').trim()}
          </span>
          {count > 0 && (
            <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="grid max-h-[75svh] w-72 gap-2 overflow-y-auto p-3">
        {shown.map((field) => {
          const own = custom?.[field.id]
          if (own) return <Fragment key={field.id}>{own}</Fragment>
          const end = field.until ? byId.get(field.until) : undefined
          if (field.type === 'number')
            return (
              <div key={field.id} className="grid grid-cols-2 gap-2">
                <AmountInput field={field} params={params} onSet={set} />
                {end && <AmountInput field={end} params={params} onSet={set} />}
              </div>
            )
          if (field.type === 'date')
            return end ? (
              <DateRange key={field.id} from={field} to={end} params={params} onChange={onChange} />
            ) : null
          return field.single ? (
            <SingleSelect key={field.id} field={field} params={params} onSet={set} />
          ) : (
            <MultiSelect key={field.id} field={field} params={params} onSet={set} />
          )
        })}
        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start text-muted-foreground"
            onClick={() => onChange(changeFor(all, [], params))}
          >
            <X />
            {translate('clearAll')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

type ControlProps<P> = {
  field: QueryField<P>
  params: P
  onSet: (field: QueryField<P>, values: string[]) => void
}

const labelOf = <P,>(field: QueryField<P>, value: string) =>
  field.values?.find((option) => option.value === value)?.label || value

/** A clear button inside a field's right edge. */
function ClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={translate('removeFilter', { label })}
      onClick={onClick}
      className="absolute top-1/2 right-8 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  )
}

function SingleSelect<P>({ field, params, onSet }: ControlProps<P>) {
  const value = field.get(params)[0] ?? ''
  return (
    <div className="relative">
      <Combobox
        value={value}
        label={field.label}
        options={[...(field.values ?? [])]}
        placeholder={field.placeholder ?? field.label}
        disabled={!field.values?.length}
        onChange={(next) => onSet(field, [next])}
        className={cn(value && 'pr-14')}
      />
      {value && (
        <ClearButton
          label={`${field.label}: ${labelOf(field, value)}`}
          onClick={() => onSet(field, [])}
        />
      )}
    </div>
  )
}

function MultiSelect<P>({ field, params, onSet }: ControlProps<P>) {
  const values = field.get(params)
  const options = (field.values ?? []).filter((option) => !values.includes(option.value))
  return (
    <div className="grid gap-1.5">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <span
              key={value}
              className="flex h-6 items-center gap-1 rounded-md bg-muted pr-0.5 pl-2 text-body-sm"
            >
              {labelOf(field, value)}
              <button
                type="button"
                aria-label={translate('removeFilter', {
                  label: `${field.label}: ${labelOf(field, value)}`,
                })}
                onClick={() =>
                  onSet(
                    field,
                    values.filter((entry) => entry !== value),
                  )
                }
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Combobox
        value=""
        label={field.label}
        options={options}
        placeholder={field.placeholder ?? field.label}
        disabled={options.length === 0}
        onChange={(value) => onSet(field, [...values, value])}
      />
    </div>
  )
}

/** An amount bound, applied on Enter or when the field is left, not on every key. */
function AmountInput<P>({ field, params, onSet }: ControlProps<P>) {
  const current = field.get(params)[0] ?? ''
  const [draft, setDraft] = useState(current)
  const [shown, setShown] = useState(current)
  if (current !== shown) {
    setShown(current)
    setDraft(current)
  }
  const apply = () => {
    const value = resolveValue(field, draft.replace(',', '.').replaceAll("'", ''))
    if (draft.trim() === '') onSet(field, [])
    else if (value !== null) onSet(field, [value])
    else setDraft(current)
  }
  return (
    <Input
      inputMode="decimal"
      aria-label={field.label}
      placeholder={field.label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={apply}
      onKeyDown={(event) => event.key === 'Enter' && apply()}
      className="tabular-nums"
    />
  )
}

const CUSTOM = '__custom'

/** A from–to date filter: presets, or two dates of one's own. */
function DateRange<P>({
  from,
  to,
  params,
  onChange,
}: {
  from: QueryField<P>
  to: QueryField<P>
  params: P
  onChange: (change: Partial<P>) => void
}) {
  const start = from.get(params)[0] ?? ''
  const end = to.get(params)[0] ?? ''
  const presets = datePresets()
  const preset = presets.find((entry) => entry.from === start && entry.to === end)
  const [custom, setCustom] = useState(false)
  const own = custom || ((start !== '' || end !== '') && !preset)
  const range = (a: string, b: string) =>
    onChange({ ...from.set(a ? [a] : [], params), ...to.set(b ? [b] : [], params) })
  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <Combobox
          value={own ? CUSTOM : (preset?.label ?? '')}
          label={from.placeholder ?? from.label}
          placeholder={from.placeholder ?? from.label}
          options={[
            ...presets.map((entry) => ({ value: entry.label, label: entry.label })),
            { value: CUSTOM, label: translate('customRange') },
          ]}
          onChange={(value) => {
            const picked = presets.find((entry) => entry.label === value)
            setCustom(value === CUSTOM)
            if (picked) range(picked.from, picked.to)
          }}
          className={cn((own || preset) && 'pr-14')}
        />
        {(own || preset) && (
          <ClearButton
            label={from.placeholder ?? from.label}
            onClick={() => {
              setCustom(false)
              range('', '')
            }}
          />
        )}
      </div>
      {own && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            aria-label={from.label}
            value={start}
            max={end || undefined}
            onChange={(event) => range(event.target.value, end)}
            className="px-2 tabular-nums"
          />
          <Input
            type="date"
            aria-label={to.label}
            value={end}
            min={start || undefined}
            onChange={(event) => range(start, event.target.value)}
            className="px-2 tabular-nums"
          />
        </div>
      )}
    </div>
  )
}

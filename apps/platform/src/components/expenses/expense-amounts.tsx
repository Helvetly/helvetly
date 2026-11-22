'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Kbd } from '@helvetly/ui/components/kbd'
import { Panel } from '@helvetly/ui/components/panel'
import { Segmented } from '@helvetly/ui/components/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import { Copy, Ellipsis, Plus, Tag, Trash2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

import { inputClass } from '@/components/clients/fields'
import { AmountInput } from '@/components/shared/amount-input'
import { PercentInput } from '@/components/shared/percent-input'
import { useExpenseCategories, type EntryMode, type Expense } from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { formatMoney, fromCents, parseDecimalInput, toCents, VAT_RATES } from '@/lib/invoices'

import {
  itemAmount,
  mergeLoses,
  newLine,
  withEntryMode,
  type FieldErrors,
  type FormValues,
  type LineValues,
} from './expense-form-model'

const RATE_CHOICES = [...VAT_RATES, '0']
const MAX_LINES = 20
// One amount: amount | VAT; several rates add a label and a remove button.
const SINGLE_GRID = 'grid-cols-[minmax(0,1fr)_92px] sm:grid-cols-[minmax(0,14rem)_92px]'
const RATES_GRID =
  'grid-cols-[minmax(0,1fr)_136px_92px_32px] max-sm:grid-cols-[minmax(0,1fr)_120px_84px_32px]'
// Items, sized by the form's column (not the screen): a table row each where it fits, # | item | qty | unit price |
// VAT | amount | actions; else a card with the figures four to a row under the item.
const ITEM_COLS = '@min-[34rem]:grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_6rem_4.5rem_6.5rem_1.75rem]'
const ITEM_ROW = cn(
  'grid grid-cols-[1.25rem_minmax(0,1fr)_1.75rem] items-start gap-x-1.5 gap-y-2',
  "[grid-template-areas:'num_item_menu'_'nums_nums_nums'] @min-[34rem]:[grid-template-areas:none]",
  ITEM_COLS,
)
const ITEM_FIELDS = ['description', 'quantity', 'unit_price', 'vat_rate', 'amount'] as const
type ItemField = (typeof ITEM_FIELDS)[number]
const LINE_ERRORS = ['description', ...ITEM_FIELDS.slice(1), 'category_id']

type Describe = (field: string) => {
  id: string
  'aria-invalid': boolean | undefined
  'aria-describedby': string | undefined
}

const Required = () => <span className="ml-0.5 text-destructive">*</span>

/**
 * The expense's amounts: one amount per VAT rate, or items with quantity, price and an optional category of their
 * own. Switching items back to one amount adds them up per rate, after asking when that drops what was entered.
 */
export function ExpenseLines({
  values,
  errors,
  newRate,
  describe,
  onValues,
  onLine,
}: {
  values: FormValues
  errors: FieldErrors
  /** The VAT rate a new line starts with. */
  newRate: string
  describe: Describe
  /** Replaces the lines (or the entry mode with them); `touched` names what changed. */
  onValues: (change: Pick<FormValues, 'lines'> & Partial<Pick<FormValues, 'entry_mode'>>) => void
  onLine: (index: number, change: Partial<LineValues>) => void
}) {
  const [merging, setMerging] = useState(false)
  const itemised = values.entry_mode === 'itemised'
  const switchTo = (mode: EntryMode) => {
    if (mode === 'single' && mergeLoses(values.lines)) return setMerging(true)
    const next = withEntryMode(values, mode)
    onValues({ entry_mode: next.entry_mode, lines: next.lines })
  }

  return (
    <div className="@container grid gap-2">
      <Segmented
        label={translate('enterAs')}
        value={values.entry_mode}
        options={[
          { value: 'single', label: translate('oneAmount') },
          { value: 'itemised', label: translate('itemised') },
        ]}
        onChange={switchTo}
      />
      {itemised ? (
        <ItemTable
          values={values}
          errors={errors}
          newRate={newRate}
          describe={describe}
          onValues={onValues}
          onLine={onLine}
        />
      ) : (
        <RateLines
          values={values}
          errors={errors}
          newRate={newRate}
          describe={describe}
          onValues={onValues}
          onLine={onLine}
        />
      )}
      <datalist id="expense-vat-rates">
        {RATE_CHOICES.map((rate) => (
          <option key={rate} value={rate}>
            {rate} %
          </option>
        ))}
      </datalist>
      {merging && (
        <ConfirmDialog
          title={translate('mergeItemsTitle')}
          body={translate('mergeItemsBody')}
          confirmLabel={translate('mergeItems')}
          cancelLabel={translate('keepEditing')}
          tone="default"
          onDecide={(merge) => {
            setMerging(false)
            if (!merge) return
            const next = withEntryMode(values, 'single')
            onValues({ entry_mode: next.entry_mode, lines: next.lines })
          }}
        />
      )}
    </div>
  )
}

type LinesProps = Parameters<typeof ExpenseLines>[0]

const lineError = (errors: FieldErrors, index: number) => {
  const field = LINE_ERRORS.find((name) => errors[`lines.${index}.${name}`])
  return field && { field, message: errors[`lines.${index}.${field}`] }
}

/** One amount: a single line is described by the expense's "What for"; several (one per VAT rate) each need a label. */
function RateLines({ values, errors, newRate, describe, onValues, onLine }: LinesProps) {
  const several = values.lines.length > 1
  return (
    <>
      <div
        aria-hidden
        className={cn('grid gap-2 text-body-sm font-medium', several ? RATES_GRID : SINGLE_GRID)}
      >
        {several && (
          <span>
            {translate('item')}
            <Required />
          </span>
        )}
        <span>
          {translate('amount')}
          <Required />
        </span>
        <span>{translate('vat2')}</span>
        {several && <span />}
      </div>
      {values.lines.map((line, index) => {
        const n = index + 1
        const error = lineError(errors, index)
        return (
          <div key={line.key} className="grid gap-1">
            <div className={cn('grid items-center gap-2', several ? RATES_GRID : SINGLE_GRID)}>
              {several && (
                <input
                  {...describe(`lines.${index}.description`)}
                  aria-label={translate('lineDescription', { value1: n })}
                  value={line.description}
                  onChange={(event) => onLine(index, { description: event.target.value })}
                  placeholder={index === 0 ? translate('eGHotel') : translate('eGBreakfast')}
                  className={inputClass}
                />
              )}
              <AmountInput
                {...describe(`lines.${index}.amount`)}
                aria-label={translate('lineAmount', { value1: n })}
                currency={values.currency}
                value={line.amount}
                onValueChange={(value) => onLine(index, { amount: value })}
                placeholder="0.00"
              />
              <PercentInput
                {...describe(`lines.${index}.vat_rate`)}
                aria-label={translate('lineVATRate', { value1: n })}
                list="expense-vat-rates"
                value={line.vat_rate}
                onValueChange={(value) => onLine(index, { vat_rate: value })}
                placeholder="8.1"
                inputClassName={cn(inputClass, 'text-right tabular-nums')}
              />
              {several && (
                <Button
                  type="button"
                  variant="destructive-ghost"
                  size="icon-sm"
                  aria-label={translate('removeLine', { value1: n })}
                  className="cursor-pointer"
                  onClick={() => onValues({ lines: values.lines.filter((_, i) => i !== index) })}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            {error && (
              <p id={`expense-lines.${index}.${error.field}-error`} className="text-xs text-destructive">
                {error.message}
              </p>
            )}
          </div>
        )
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={values.lines.length >= MAX_LINES}
        className="cursor-pointer justify-self-start text-muted-foreground"
        onClick={() => onValues({ lines: [...values.lines, newLine(newRate)] })}
      >
        <Plus />
        {translate('addALineForAnotherVATRate')}
      </Button>
    </>
  )
}

const cellOf = (key: string, field: ItemField) =>
  document.querySelector<HTMLInputElement>(`[data-item="${key}"][data-field="${field}"]`)

/**
 * Items as a line-item table: one row per item with its number, name, quantity, unit price, VAT and amount, its
 * category and the rest in a menu. Enter goes to the same field of the next item, and on the last adds one.
 */
function ItemTable({ values, errors, newRate, describe, onValues, onLine }: LinesProps) {
  const categories = useExpenseCategories().data ?? []
  const lines = values.lines
  // Focus moves once the new row is in the DOM, before the next keystroke lands.
  const focusNext = useRef<{ key: string; field: ItemField } | null>(null)
  useLayoutEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    cellOf(target.key, target.field)?.focus()
  })

  const insertAfter = (index: number, line: LineValues) => {
    onValues({ lines: [...lines.slice(0, index + 1), line, ...lines.slice(index + 1)] })
    focusNext.current = { key: line.key, field: 'description' }
  }
  const add = () => {
    if (lines.length >= MAX_LINES) return
    // A new item keeps the VAT rate of the one above: items usually come in kind.
    insertAfter(lines.length - 1, newLine(lines.at(-1)?.vat_rate ?? newRate))
  }
  const remove = (index: number) => {
    const next = lines.filter((_, i) => i !== index)
    onValues({ lines: next })
    const neighbour = next[Math.max(0, index - 1)]
    if (neighbour) focusNext.current = { key: neighbour.key, field: 'description' }
  }
  const setPrice = (
    index: number,
    line: LineValues,
    change: Pick<LineValues, 'quantity'> | Pick<LineValues, 'unit_price'>,
  ) => {
    const next = { ...line, ...change }
    const amount = itemAmount(next.quantity, next.unit_price)
    onLine(index, amount === null ? change : { ...change, amount })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number, field: ItemField) => {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey) return
    event.preventDefault()
    const next = lines[index + 1]
    if (next) cellOf(next.key, field)?.focus()
    else add()
  }
  const cell = (index: number, field: ItemField) => ({
    ...describe(`lines.${index}.${field}`),
    'data-item': lines[index]?.key,
    'data-field': field,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => onKeyDown(event, index, field),
  })
  const subtotal = lines.reduce(
    (sum, line) => sum + toCents(parseDecimalInput(line.amount, 2, true) ?? '0'),
    0n,
  )

  return (
    <>
      <p className="text-body-sm text-muted-foreground">{translate('oneLinePerItem')}</p>
      <div className="grid gap-2 @min-[34rem]:gap-0">
        <div
          aria-hidden
          className={cn(
            'hidden gap-x-1.5 border-b border-border pb-1.5 text-body-sm font-medium @min-[34rem]:grid',
            ITEM_COLS,
          )}
        >
          <span className="text-center text-muted-foreground">#</span>
          <span>
            {translate('item')}
            <Required />
          </span>
          <span className="text-right">{translate('qty')}</span>
          <span className="text-right">{translate('unitPrice')}</span>
          <span className="text-right">{translate('vat2')}</span>
          <span className="text-right">
            {translate('amount')}
            <Required />
          </span>
          <span />
        </div>
        {lines.map((line, index) => {
          const n = index + 1
          const error = lineError(errors, index)
          const own = line.category_id
            ? categories.find((category) => category.id === line.category_id)
            : undefined
          const label = (text: string) => (
            <span aria-hidden className="text-caption text-muted-foreground @min-[34rem]:hidden">
              {text}
            </span>
          )
          return (
            <div
              key={line.key}
              data-testid="expense-item"
              className={cn(
                'group/item grid gap-1 rounded-lg p-2.5 ring-1 ring-border/70 transition-colors',
                '@min-[34rem]:rounded-none @min-[34rem]:border-b @min-[34rem]:border-border/60 @min-[34rem]:px-0 @min-[34rem]:py-1.5 @min-[34rem]:ring-0 @min-[34rem]:hover:bg-muted/40',
              )}
            >
              <div className={ITEM_ROW}>
                <span className="flex h-9 items-center justify-center text-body-sm text-muted-foreground tabular-nums [grid-area:num] @min-[34rem]:[grid-area:auto]">
                  {n}
                </span>
                <div className="grid min-w-0 gap-1 [grid-area:item] @min-[34rem]:[grid-area:auto]">
                  <input
                    {...cell(index, 'description')}
                    aria-label={translate('lineDescription', { value1: n })}
                    value={line.description}
                    onChange={(event) => onLine(index, { description: event.target.value })}
                    placeholder={index === 0 ? translate('eGHotel') : translate('eGBreakfast')}
                    className={inputClass}
                  />
                  {own && (
                    <Badge
                      variant="outline"
                      size="sm"
                      data-testid="item-category"
                      title={`${own.account_code} · ${own.name}`}
                    >
                      <Tag />
                      <span className="truncate">{own.name}</span>
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1.5 [grid-area:nums] @min-[34rem]:contents">
                  <div className="grid min-w-0 gap-0.5">
                    {label(translate('qty'))}
                    <input
                      {...cell(index, 'quantity')}
                      aria-label={translate('lineQuantity', { value1: n })}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => setPrice(index, line, { quantity: event.target.value })}
                      placeholder="1"
                      className={cn(inputClass, 'px-2 text-right tabular-nums')}
                    />
                  </div>
                  <div className="grid min-w-0 gap-0.5">
                    {label(translate('unitPrice'))}
                    <AmountInput
                      {...cell(index, 'unit_price')}
                      aria-label={translate('lineUnitPrice', { value1: n })}
                      value={line.unit_price}
                      onValueChange={(value) => setPrice(index, line, { unit_price: value })}
                      placeholder="0.00"
                      className="px-2"
                    />
                  </div>
                  <div className="grid min-w-0 gap-0.5">
                    {label(translate('vat2'))}
                    <PercentInput
                      {...cell(index, 'vat_rate')}
                      aria-label={translate('lineVATRate', { value1: n })}
                      list="expense-vat-rates"
                      value={line.vat_rate}
                      onValueChange={(value) => onLine(index, { vat_rate: value })}
                      placeholder="8.1"
                      compact
                      inputClassName={cn(inputClass, 'pl-2 text-right tabular-nums')}
                    />
                  </div>
                  <div className="grid min-w-0 gap-0.5">
                    {label(translate('amount'))}
                    <AmountInput
                      {...cell(index, 'amount')}
                      aria-label={translate('lineAmount', { value1: n })}
                      value={line.amount}
                      onValueChange={(value) => onLine(index, { amount: value })}
                      placeholder="0.00"
                      className="px-2 font-medium"
                    />
                  </div>
                </div>
                <div className="flex h-9 items-center justify-center [grid-area:menu] @min-[34rem]:[grid-area:auto]">
                  <ItemMenu
                    n={n}
                    line={line}
                    only={lines.length === 1}
                    full={lines.length >= MAX_LINES}
                    categories={categories}
                    onCategory={(category_id) => onLine(index, { category_id })}
                    onDuplicate={() => insertAfter(index, { ...line, key: newLine('').key })}
                    onDelete={() => remove(index)}
                  />
                </div>
              </div>
              {error && (
                <p
                  id={`expense-lines.${index}.${error.field}-error`}
                  className="text-xs text-destructive @min-[34rem]:pl-[1.625rem]"
                >
                  {error.message}
                </p>
              )}
            </div>
          )
        })}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 @min-[34rem]:pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={lines.length >= MAX_LINES}
            className="cursor-pointer text-muted-foreground"
            onClick={add}
          >
            <Plus />
            {translate('addAnItem')}
            <Kbd className="ml-1 hidden @min-[34rem]:inline-flex">{translate('enter')}</Kbd>
          </Button>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {translate('itemCount', { count: lines.length })}
            {' · '}
            {translate('subtotal')} {formatMoney(fromCents(subtotal), values.currency)}
          </span>
        </div>
      </div>
    </>
  )
}

/** An item's actions: its own category (the expense's by default), duplicate, delete. */
function ItemMenu({
  n,
  line,
  only,
  full,
  categories,
  onCategory,
  onDuplicate,
  onDelete,
}: {
  n: number
  line: LineValues
  only: boolean
  full: boolean
  categories: NonNullable<ReturnType<typeof useExpenseCategories>['data']>
  onCategory: (id: string) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('actionsForItem', { value1: n })}
          className="cursor-pointer text-muted-foreground"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Tag />
            {translate('category')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 min-w-56 overflow-y-auto">
            <DropdownMenuRadioGroup value={line.category_id} onValueChange={onCategory}>
              <DropdownMenuRadioItem value="">
                {translate('defaultExpenseCategory')}
              </DropdownMenuRadioItem>
              {categories
                .filter((category) => !category.is_archived || category.id === line.category_id)
                .map((category) => (
                  <DropdownMenuRadioItem key={category.id} value={category.id}>
                    {category.name}
                    <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                      {category.account_code}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem disabled={full} onSelect={onDuplicate}>
          <Copy />
          {translate('duplicateItem')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={only} onSelect={onDelete}>
          <Trash2 />
          {translate('deleteItem')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Net, VAT, gross and the reclaimable part, as the server computed them, on a card like the app's others. */
export function ExpenseTotals({
  expense,
  foreign,
  loading,
}: {
  expense: Expense | undefined
  foreign: boolean
  loading: boolean
}) {
  if (!expense) return null
  const rows = [
    { label: translate('net2'), value: formatMoney(expense.net_total, expense.currency) },
    ...expense.vat_breakdown
      .filter((group) => group.rate !== '0')
      .map((group) => ({
        label: translate('vatOn', {
          rate: group.rate,
          value2: formatMoney(group.taxable_amount, expense.currency),
        }),
        value: formatMoney(group.vat_amount, expense.currency),
      })),
  ]
  return (
    <Panel className={cn('transition-opacity', loading && 'opacity-60')}>
      <div aria-live="polite" data-testid="expense-totals" className="grid gap-1.5 text-body-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 text-muted-foreground">
            <span>{row.label}</span>
            <span className="tabular-nums">{row.value}</span>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-border/70 pt-1.5 text-body font-medium">
          <span>{translate('total')}</span>
          <span className="tabular-nums">{formatMoney(expense.total, expense.currency)}</span>
        </div>
        {foreign && (
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>
              {translate('in2')}
              {expense.base.currency}
            </span>
            <span className="tabular-nums">
              {formatMoney(expense.base.total, expense.base.currency)}
            </span>
          </div>
        )}
        <div className="flex justify-between gap-4 text-success">
          <span>{translate('reclaimableInputTax2')}</span>
          <span className="tabular-nums">
            {formatMoney(expense.base.deductible_vat, expense.base.currency)}
          </span>
        </div>
      </div>
    </Panel>
  )
}

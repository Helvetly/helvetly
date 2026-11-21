'use client'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Panel } from '@helvetly/ui/components/panel'
import { Segmented } from '@helvetly/ui/components/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { inputClass } from '@/components/clients/fields'
import { AmountInput } from '@/components/shared/amount-input'
import { PercentInput } from '@/components/shared/percent-input'
import { useExpenseCategories, type EntryMode, type Expense } from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { formatMoney, VAT_RATES } from '@/lib/invoices'

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
// Single: item | amount | VAT | remove. Itemised adds quantity, unit price and category.
const SINGLE_GRID =
  'grid-cols-[minmax(0,1fr)_136px_92px_32px] max-sm:grid-cols-[minmax(0,1fr)_120px_84px_32px]'
// Sized by the lines' own width (the form's column), not the screen: where it fits, item | quantity | unit price |
// amount, with the category and VAT rate under them; else a card per item.
const ITEM_COLS = '@min-[34rem]:grid-cols-[minmax(0,1fr)_64px_128px_128px_32px]'
const ITEM_GRID = cn(
  'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px]',
  "[grid-template-areas:'item_item_del'_'qty_price_price'_'vat_amount_amount'_'cat_cat_cat']",
  ITEM_COLS,
  "@min-[34rem]:[grid-template-areas:'item_qty_price_amount_del'_'cat_cat_vat_._.']",
)
const area = {
  item: '[grid-area:item]',
  qty: '[grid-area:qty]',
  price: '[grid-area:price]',
  vat: '[grid-area:vat]',
  amount: '[grid-area:amount]',
  category: '[grid-area:cat]',
  remove: '[grid-area:del]',
}

type Describe = (field: string) => {
  id: string
  'aria-invalid': boolean | undefined
  'aria-describedby': string | undefined
}

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
  const setPrice = (
    index: number,
    line: LineValues,
    change: Pick<LineValues, 'quantity'> | Pick<LineValues, 'unit_price'>,
  ) => {
    const next = { ...line, ...change }
    const amount = itemAmount(next.quantity, next.unit_price)
    onLine(index, amount === null ? change : { ...change, amount })
  }
  const errorField = (index: number) =>
    ['amount', 'vat_rate', 'quantity', 'unit_price', 'category_id'].find(
      (field) => errors[`lines.${index}.${field}`],
    )

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
      {itemised && (
        <p className="text-body-sm text-muted-foreground">{translate('oneLinePerItem')}</p>
      )}
      <div
        aria-hidden
        className={cn(
          'grid gap-2 text-body-sm font-medium',
          itemised ? cn('hidden @min-[34rem]:grid', ITEM_COLS) : SINGLE_GRID,
        )}
      >
        <span>{translate('item')}</span>
        {itemised && <span>{translate('qty')}</span>}
        {itemised && <span>{translate('unitPrice')}</span>}
        {itemised || (
          <span>
            {translate('amount')}
            <span className="ml-0.5 text-destructive">*</span>
          </span>
        )}
        {itemised || <span>{translate('vat2')}</span>}
        {itemised && (
          <span>
            {translate('amount')}
            <span className="ml-0.5 text-destructive">*</span>
          </span>
        )}
        <span />
      </div>
      {values.lines.map((line, index) => {
        const n = index + 1
        const description = (
          <input
            aria-label={translate('lineDescription', { value1: n })}
            value={line.description}
            onChange={(event) => onLine(index, { description: event.target.value })}
            placeholder={index === 0 ? translate('optionalEGHotel') : translate('eGBreakfast')}
            className={cn(inputClass, itemised && area.item)}
          />
        )
        const amount = (
          <AmountInput
            {...describe(`lines.${index}.amount`)}
            aria-label={translate('lineAmount', { value1: n })}
            currency={values.currency}
            value={line.amount}
            onValueChange={(value) => onLine(index, { amount: value })}
            placeholder="0.00"
          />
        )
        const rate = (
          <PercentInput
            {...describe(`lines.${index}.vat_rate`)}
            aria-label={translate('lineVATRate', { value1: n })}
            list="expense-vat-rates"
            value={line.vat_rate}
            onValueChange={(value) => onLine(index, { vat_rate: value })}
            placeholder="8.1"
            className={cn(itemised && area.vat)}
            inputClassName={cn(inputClass, 'text-right tabular-nums')}
          />
        )
        const remove = (
          <Button
            type="button"
            variant="destructive-ghost"
            size="icon-sm"
            aria-label={translate('removeLine', { value1: n })}
            disabled={values.lines.length === 1}
            className={cn('cursor-pointer', itemised && area.remove)}
            onClick={() => onValues({ lines: values.lines.filter((_, i) => i !== index) })}
          >
            <Trash2 />
          </Button>
        )
        const field = errorField(index)
        return (
          <div
            key={line.key}
            className={cn(
              'grid gap-1',
              itemised && index > 0 && '@min-[34rem]:border-t @min-[34rem]:pt-2',
            )}
          >
            {itemised ? (
              <div
                data-testid="expense-item"
                className={cn(
                  'grid items-center gap-2 rounded-lg p-3 ring-1 ring-border',
                  '@min-[34rem]:rounded-none @min-[34rem]:p-0 @min-[34rem]:ring-0',
                  ITEM_GRID,
                )}
              >
                {description}
                <input
                  {...describe(`lines.${index}.quantity`)}
                  aria-label={translate('lineQuantity', { value1: n })}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => setPrice(index, line, { quantity: event.target.value })}
                  placeholder={translate('qty')}
                  className={cn(inputClass, 'text-right tabular-nums', area.qty)}
                />
                <div className={cn('min-w-0', area.price)}>
                  <AmountInput
                    {...describe(`lines.${index}.unit_price`)}
                    aria-label={translate('lineUnitPrice', { value1: n })}
                    currency={values.currency}
                    value={line.unit_price}
                    onValueChange={(value) => setPrice(index, line, { unit_price: value })}
                    placeholder={translate('unitPrice')}
                  />
                </div>
                {rate}
                <LineCategory
                  index={index}
                  value={line.category_id}
                  invalid={Boolean(errors[`lines.${index}.category_id`])}
                  onChange={(category_id) => onLine(index, { category_id })}
                />
                <div className={cn('min-w-0', area.amount)}>{amount}</div>
                {remove}
              </div>
            ) : (
              <div className={cn('grid items-center gap-2', SINGLE_GRID)}>
                {description}
                {amount}
                {rate}
                {remove}
              </div>
            )}
            {field && (
              <p id={`expense-lines.${index}.${field}-error`} className="text-xs text-destructive">
                {errors[`lines.${index}.${field}`]}
              </p>
            )}
          </div>
        )
      })}
      <datalist id="expense-vat-rates">
        {RATE_CHOICES.map((rate) => (
          <option key={rate} value={rate}>
            {rate} %
          </option>
        ))}
      </datalist>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={values.lines.length >= MAX_LINES}
        className="cursor-pointer justify-self-start text-muted-foreground"
        onClick={() => onValues({ lines: [...values.lines, newLine(newRate)] })}
      >
        <Plus />
        {itemised ? translate('addAnItem') : translate('addALineForAnotherVATRate')}
      </Button>
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

/** An item's category: the expense's own unless another active one is chosen. */
function LineCategory({
  index,
  value,
  invalid,
  onChange,
}: {
  index: number
  value: string
  invalid: boolean
  onChange: (value: string) => void
}) {
  const categories = useExpenseCategories().data ?? []
  const options = [
    { value: '', label: translate('defaultExpenseCategory') },
    ...categories
      .filter((category) => !category.is_archived || category.id === value)
      .map((category) => ({
        value: category.id,
        label: category.name,
        hint: category.account_code,
      })),
  ]
  return (
    <Combobox
      id={`expense-lines.${index}.category_id`}
      label={translate('lineCategory', { value1: index + 1 })}
      value={value}
      options={options}
      invalid={invalid}
      placeholder={translate('defaultExpenseCategory')}
      contentClassName="w-64"
      className={area.category}
      onChange={onChange}
    />
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

'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Copy,
  Ellipsis,
  Package,
  GripVertical,
  Percent,
  Plus,
  Trash2,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

import { ProductPicker } from '@/components/products/product-picker'
import { translate } from '@/lib/i18n'
import {
  defaultExemptionCode,
  EXEMPTION_CATEGORIES,
  formatAmount,
  parseDecimalInput,
  UNITS,
  VAT_CATEGORIES,
  VAT_RATES,
  VATEX_CODES,
  type VatMode,
} from '@/lib/invoices'

import {
  addPickedLine,
  lineKey,
  moveLine,
  newLine,
  type EditorErrors,
  type EditorLine,
} from './editor-model'

/** A foreign-priced catalogue line still waiting for its price. */
export const needsPrice = (line: EditorLine) =>
  Boolean(line.price_currency) && !line.unit_price.trim()

type Field = 'description' | 'quantity' | 'unit_price' | 'discount_percent'
const NUMBER_FIELDS = new Set<Field>(['quantity', 'unit_price', 'discount_percent'])

const cell = (key: string, field: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-line="${key}"][data-field="${field}"]`,
  )

/** Focuses a cell from outside the grid (e.g. "Show me" on a cannot-issue reason). */
export const focusCell = (key: string, field: string) =>
  requestAnimationFrame(() => cell(key, field)?.focus())

/** The row under the pointer while dragging. */
const rowAt = (y: number) => {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')]
  const found = rows.findIndex((row) => y < row.getBoundingClientRect().bottom)
  return found === -1 ? rows.length - 1 : found
}

/**
 * A menu restores focus to its trigger once it has faded out. If the person moved on meanwhile
 * (Enter in a description, a click elsewhere), pulling focus back would swallow what they type.
 */
const keepFocus = (event: Event) => {
  const active = document.activeElement
  if (active && active !== document.body && !active.closest('[role=menu]')) event.preventDefault()
}

const cellInput =
  'h-8 w-full min-w-0 rounded-md bg-transparent px-2 text-[14px] leading-5 tabular-nums outline-none transition-colors placeholder:text-placeholder hover:bg-muted/60 focus:bg-card focus:ring-2 focus:ring-ring/40 aria-invalid:bg-destructive/5 aria-invalid:ring-2 aria-invalid:ring-destructive/40'

const VAT_SHORT: Record<string, string> = {
  Z: translate('zero'),
  E: translate('exempt'),
  AE: 'RC',
  K: 'EU',
  G: translate('export'),
  O: translate('none2'),
}
const vatLabel = (line: EditorLine) =>
  line.vat_category === 'S'
    ? `${line.vat_rate || '0'}%`
    : (VAT_SHORT[line.vat_category] ?? line.vat_category)

/**
 * The lines as a keyboard-first grid: Enter adds a line, ⇧Enter breaks the description, ↑/↓ move
 * between rows in number fields, ⌥↑/⌥↓ move the line, Backspace in an empty line removes it.
 */
export function LinesEditor({
  lines,
  vatMode,
  defaultRate,
  amounts,
  errors,
  onChange,
  currency,
}: {
  lines: EditorLine[]
  vatMode: VatMode
  defaultRate: string
  /** From the preview, in row order; undefined while it loads. */
  amounts: string[] | undefined
  errors: EditorErrors
  onChange: (lines: EditorLine[]) => void
  /** For the catalogue's prices. */
  currency: string
}) {
  const [showDiscount, setShowDiscount] = useState(() =>
    lines.some((line) => line.discount_percent.trim() !== ''),
  )
  const [dragging, setDragging] = useState<number | null>(null)
  // Focus moves once the changed rows are in the DOM, before the next keystroke lands.
  const focusNext = useRef<{
    key: string
    field: string
    atEnd?: boolean
    select?: boolean
  } | null>(null)
  useLayoutEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    const element = cell(target.key, target.field)
    element?.focus()
    if (target.select) element?.select()
    else if (target.atEnd && element)
      element.setSelectionRange(element.value.length, element.value.length)
  })
  const focusCellAfter = (key: string, field: string, atEnd = false) => {
    focusNext.current = { key, field, atEnd }
  }
  const [dropAt, setDropAt] = useState<number | null>(null)
  const withVat = vatMode !== 'none'
  const columns = cn(
    'grid items-start gap-x-1',
    'grid-cols-[14px_minmax(180px,1fr)_72px_76px_112px_120px_28px]',
    showDiscount &&
      withVat &&
      'grid-cols-[14px_minmax(180px,1fr)_72px_76px_112px_64px_84px_120px_28px]',
    showDiscount &&
      !withVat &&
      'grid-cols-[14px_minmax(180px,1fr)_72px_76px_112px_64px_120px_28px]',
    !showDiscount &&
      withVat &&
      'grid-cols-[14px_minmax(180px,1fr)_72px_76px_112px_84px_120px_28px]',
  )

  const set = (index: number, change: Partial<EditorLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...change } : line)))

  const insertAfter = (index: number, field: Field = 'description') => {
    const previous = lines[index]
    const line = {
      ...newLine({ vat_mode: vatMode }, defaultRate),
      // A new line keeps the unit and VAT of the one above: lines usually come in kind.
      ...(previous && {
        unit: previous.unit,
        vat_category: previous.vat_category,
        vat_rate: previous.vat_rate,
      }),
    }
    onChange([...lines.slice(0, index + 1), line, ...lines.slice(index + 1)])
    focusCellAfter(line.key, field)
  }

  const remove = (index: number) => {
    const next = lines.filter((_, i) => i !== index)
    onChange(next.length ? next : [newLine({ vat_mode: vatMode }, defaultRate)])
    const neighbour = next[Math.max(0, index - 1)]
    if (neighbour) focusCellAfter(neighbour.key, 'description', true)
  }

  const move = (index: number, to: number) => {
    const line = lines[index]
    onChange(moveLine(lines, index, to))
    if (line) focusCellAfter(line.key, 'description')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number, field: Field) => {
    const line = lines[index]
    if (!line) return
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      move(index, index + (event.key === 'ArrowUp' ? -1 : 1))
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      const next = lines[index + 1]
      if (field === 'description' || !next) insertAfter(index, field)
      else cell(next.key, field)?.focus()
      return
    }
    if (NUMBER_FIELDS.has(field) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const target = lines[index + (event.key === 'ArrowUp' ? -1 : 1)]
      if (target) {
        event.preventDefault()
        cell(target.key, field)?.focus()
      }
      return
    }
    if (
      event.key === 'Backspace' &&
      field === 'description' &&
      line.description === '' &&
      !line.unit_price &&
      lines.length > 1
    ) {
      event.preventDefault()
      remove(index)
    }
  }

  const describe = (line: EditorLine, field: string) => {
    const error =
      errors[`${line.key}.${field}`] ??
      (field === 'unit_price' && needsPrice(line)
        ? translate('enterThePrice2', { currency: currency })
        : undefined) ??
      (field === 'vat_exemption_code' && !line.vat_exemption_code
        ? translate('chooseTheExemptionBasis')
        : undefined)
    return {
      'data-line': line.key,
      'data-field': field,
      'aria-invalid': error ? true : undefined,
      title: error,
    }
  }

  return (
    <fieldset className="grid min-w-0">
      <legend className="sr-only">{translate('lines')}</legend>
      <div
        aria-hidden
        className={cn(
          columns,
          'h-9 items-center border-b border-foreground/80 text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase',
        )}
      >
        <span />
        <span className="px-2">{translate('description')}</span>
        <span className="px-2 text-right">{translate('qty')}</span>
        <span className="px-2">{translate('unit')}</span>
        <span className="px-2 text-right">{translate('price2')}</span>
        {showDiscount && <span className="px-2 text-right">{translate('disc')}</span>}
        {withVat && <span className="px-2">{translate('vat')}</span>}
        <span className="px-2 text-right">{translate('amount')}</span>
        <span />
      </div>

      {lines.map((line, index) => {
        const description = errors[`${line.key}.description`]
        return (
          <div
            key={line.key}
            data-row={index}
            className={cn(
              columns,
              'group/line relative border-b border-border/70 py-1',
              dragging === index && 'opacity-40',
              dropAt === index &&
                dragging !== null &&
                dragging !== index &&
                (dragging < index
                  ? 'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-ring'
                  : 'after:absolute after:inset-x-0 after:-top-px after:h-0.5 after:bg-ring'),
            )}
          >
            <button
              type="button"
              draggable
              aria-label={translate('moveLineDragOr', { value1: index + 1 })}
              onKeyDown={(event) => onKeyDown(event, index, 'description')}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', line.key)
                setDragging(index)
              }}
              onDrag={(event) => {
                // The last drag event reports 0,0: keep the target from before it.
                if (event.clientY) setDropAt(rowAt(event.clientY))
              }}
              onDragEnd={() => {
                if (dropAt !== null) move(index, dropAt)
                setDragging(null)
                setDropAt(null)
              }}
              className="flex h-8 cursor-grab items-center justify-center rounded text-muted-foreground/0 transition-colors group-hover/line:text-muted-foreground/70 focus-visible:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
            >
              <GripVertical className="size-3.5" />
            </button>
            <span className="grid">
              <textarea
                {...describe(line, 'description')}
                aria-label={translate('lineDescription', { value1: index + 1 })}
                rows={1}
                value={line.description}
                maxLength={500}
                onChange={(event) => set(index, { description: event.target.value })}
                onKeyDown={(event) => onKeyDown(event, index, 'description')}
                placeholder={
                  index === 0
                    ? translate('whatDidYouDeliverEGWebsiteDesign')
                    : translate('description')
                }
                className={cn(
                  cellInput,
                  'block [field-sizing:content] h-auto min-h-8 resize-none py-1.5',
                )}
              />
              {description && (
                <span className="px-2 pt-0.5 text-[12px] text-destructive">{description}</span>
              )}
              {withVat && EXEMPTION_CATEGORIES.includes(line.vat_category) && (
                <>
                  <select
                    {...describe(line, 'vat_exemption_code')}
                    aria-label={translate('lineVATExemptionCode', { value1: index + 1 })}
                    value={line.vat_exemption_code ?? ''}
                    onChange={(event) =>
                      set(index, { vat_exemption_code: event.target.value || null })
                    }
                    className={cn(cellInput, 'text-[12.5px] text-muted-foreground')}
                  >
                    <option value="">{translate('exemptionBasis')}</option>
                    {VATEX_CODES.map((code) => (
                      <option key={code.value} value={code.value}>
                        {code.value} – {code.label}
                      </option>
                    ))}
                  </select>
                  <input
                    {...describe(line, 'vat_exemption_reason')}
                    aria-label={translate('lineVATExemptionReason', { value1: index + 1 })}
                    value={line.vat_exemption_reason}
                    maxLength={300}
                    onChange={(event) => set(index, { vat_exemption_reason: event.target.value })}
                    placeholder={translate('reasonOptionalEGArt21MWSTG')}
                    className={cn(cellInput, 'text-[12.5px] text-muted-foreground')}
                  />
                </>
              )}
            </span>
            <span>
              <input
                {...describe(line, 'quantity')}
                aria-label={translate('lineQuantity', { value1: index + 1 })}
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) => set(index, { quantity: event.target.value })}
                onKeyDown={(event) => onKeyDown(event, index, 'quantity')}
                placeholder="1"
                className={cn(cellInput, 'text-right')}
              />
            </span>
            <span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={translate('lineUnit', { value1: index + 1 })}
                    className={cn(
                      cellInput,
                      'flex items-center gap-1.5 text-left',
                      !line.unit && 'text-muted-foreground',
                    )}
                  >
                    <span className="whitespace-nowrap">
                      {UNITS.find((unit) => unit.value === line.unit)?.short ?? 'unit'}
                    </span>
                    <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground/50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  onCloseAutoFocus={keepFocus}
                  align="start"
                  className="min-w-40"
                >
                  <DropdownMenuRadioGroup
                    value={line.unit ?? ''}
                    onValueChange={(value) =>
                      set(index, {
                        unit: UNITS.find((unit) => unit.value === value)?.value ?? null,
                      })
                    }
                  >
                    <DropdownMenuRadioItem value="">{translate('noUnit')}</DropdownMenuRadioItem>
                    {UNITS.map((unit) => (
                      <DropdownMenuRadioItem key={unit.value} value={unit.value}>
                        {unit.label}
                        <span className="ml-auto text-xs text-muted-foreground">{unit.short}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
            <span>
              <input
                {...describe(line, 'unit_price')}
                aria-label={translate('linePrice', { value1: index + 1 })}
                inputMode="decimal"
                value={line.unit_price}
                onChange={(event) => set(index, { unit_price: event.target.value })}
                onBlur={() => {
                  // Typed "1450" reads back as "1’450.00"; anything unparsable stays for its error.
                  const price = parseDecimalInput(line.unit_price, 2, true)
                  if (price && !price.startsWith('-'))
                    set(index, { unit_price: formatAmount(price) })
                }}
                onKeyDown={(event) => onKeyDown(event, index, 'unit_price')}
                placeholder="0.00"
                className={cn(cellInput, 'text-right')}
              />
              {needsPrice(line) && (
                <span className="block px-2 pt-0.5 text-[12px] text-destructive">
                  {translate('pricedIn')}
                  {line.price_currency}
                  {translate('enterThe')}
                  {currency}
                  {translate('message5')}
                  {translate('price')}
                </span>
              )}
            </span>
            {showDiscount && (
              <span>
                <input
                  {...describe(line, 'discount_percent')}
                  aria-label={translate('lineDiscountPercent', { value1: index + 1 })}
                  inputMode="decimal"
                  value={line.discount_percent}
                  onChange={(event) => set(index, { discount_percent: event.target.value })}
                  onKeyDown={(event) => onKeyDown(event, index, 'discount_percent')}
                  placeholder="0%"
                  className={cn(cellInput, 'text-right')}
                />
              </span>
            )}
            {withVat && (
              <span>
                <VatPicker line={line} index={index} onChange={(change) => set(index, change)} />
              </span>
            )}
            <span className="flex h-8 items-center justify-end px-2 text-[14px] tabular-nums">
              {amounts?.[index] !== undefined ? (
                formatAmount(amounts[index])
              ) : (
                <Loader className="min-h-0 w-auto" />
              )}
            </span>
            <span className="flex h-8 items-center justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={translate('actionsForLine', { value1: index + 1 })}
                    className="text-muted-foreground opacity-0 group-hover/line:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 max-md:opacity-100"
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuItem disabled={index === 0} onSelect={() => move(index, index - 1)}>
                    <ArrowUp />
                    {translate('moveUp')}{' '}
                    <span className="ml-auto text-xs text-muted-foreground">⌥↑</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === lines.length - 1}
                    onSelect={() => move(index, index + 1)}
                  >
                    <ArrowDown />
                    {translate('moveDown')}{' '}
                    <span className="ml-auto text-xs text-muted-foreground">⌥↓</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      const copy = { ...line, key: lineKey() }
                      onChange([...lines.slice(0, index + 1), copy, ...lines.slice(index + 1)])
                      focusCellAfter(copy.key, 'description', true)
                    }}
                  >
                    <Copy />
                    {translate('duplicateLine')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => remove(index)}>
                    <Trash2 />
                    {translate('deleteLine')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
        )
      })}

      <div className="flex flex-wrap items-center gap-1 pt-2">
        <Button
          variant="ghost"
          data-field="add-line"
          className="gap-1.5 px-2 text-muted-foreground"
          onClick={() => insertAfter(lines.length - 1)}
        >
          <Plus className="size-4" />
          {translate('addLine')}
          <kbd className="ml-1 rounded border border-border px-1 font-sans text-[11px] text-muted-foreground">
            {translate('enter')}
          </kbd>
        </Button>
        <ProductPicker
          currency={currency}
          vatMode={vatMode}
          onPick={(picked, product) => {
            // Never converted: the person types the price in the invoice's currency.
            const foreign = product.currency !== currency
            const next = addPickedLine(
              lines,
              foreign ? { ...picked, unit_price: '' } : picked,
              vatMode,
              defaultRate,
            )
            onChange(
              next.lines.map((line) =>
                line.key === next.key
                  ? {
                      ...line,
                      vat_exemption_code: defaultExemptionCode(line.vat_category),
                      ...(foreign && { price_currency: product.currency }),
                    }
                  : line,
              ),
            )
            focusNext.current = foreign
              ? { key: next.key, field: 'unit_price' }
              : // Selected, so typing the quantity replaces the 1.
                { key: next.key, field: 'quantity', select: true }
          }}
          trigger={
            <Button variant="ghost" className="gap-1.5 px-2 text-muted-foreground">
              <Package className="size-3.5" />
              {translate('addFromCatalogue')}
            </Button>
          }
        />
        {!showDiscount && (
          <Button
            variant="ghost"
            className="gap-1.5 px-2 text-muted-foreground"
            onClick={() => setShowDiscount(true)}
          >
            <Percent className="size-3.5" />
            {translate('lineDiscounts')}
          </Button>
        )}
      </div>
    </fieldset>
  )
}

function VatPicker({
  line,
  index,
  onChange,
}: {
  line: EditorLine
  index: number
  onChange: (change: Partial<EditorLine>) => void
}) {
  const [custom, setCustom] = useState('')
  const value = line.vat_category === 'S' ? `S:${line.vat_rate}` : line.vat_category
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={translate('lineVAT', { value1: index + 1, value2: vatLabel(line) })}
          className={cn(cellInput, 'flex items-center gap-1.5 text-left')}
        >
          <span className="whitespace-nowrap">{vatLabel(line)}</span>
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground/50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onCloseAutoFocus={keepFocus} align="end" className="min-w-64">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next.startsWith('S:'))
              onChange({ vat_category: 'S', vat_rate: next.slice(2), vat_exemption_code: null })
            else {
              const category = VAT_CATEGORIES.find((entry) => entry.value === next)?.value
              if (category)
                onChange({
                  vat_category: category,
                  vat_rate: '0',
                  vat_exemption_code: defaultExemptionCode(category),
                })
            }
          }}
        >
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {translate('swissVATRates')}
          </DropdownMenuLabel>
          {VAT_RATES.map((rate) => (
            <DropdownMenuRadioItem key={rate} value={`S:${rate}`}>
              {rate}%
              <span className="ml-auto text-xs text-muted-foreground">
                {rate === '8.1'
                  ? translate('standard')
                  : rate === '3.8'
                    ? translate('accommodation')
                    : translate('reduced')}
              </span>
            </DropdownMenuRadioItem>
          ))}
          {line.vat_category === 'S' &&
            !(VAT_RATES as readonly string[]).includes(line.vat_rate) && (
              <DropdownMenuRadioItem value={value}>{line.vat_rate}%</DropdownMenuRadioItem>
            )}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <input
              aria-label={translate('otherRate')}
              inputMode="decimal"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter' && custom.trim())
                  onChange({
                    vat_category: 'S',
                    vat_rate: custom.trim().replace(',', '.'),
                    vat_exemption_code: null,
                  })
              }}
              placeholder={translate('otherRateEG19')}
              className="h-7 w-full rounded-md border border-input bg-card px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <span className="text-[13px] text-muted-foreground">%</span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {translate('noVATOnThisLine')}
          </DropdownMenuLabel>
          {VAT_CATEGORIES.filter(
            (category) => category.value !== 'S' && category.value !== 'O',
          ).map((category) => (
            <DropdownMenuRadioItem
              key={category.value}
              value={category.value}
              className="items-start"
            >
              <span className="grid">
                {category.label}
                <span className="text-xs text-muted-foreground">{category.hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

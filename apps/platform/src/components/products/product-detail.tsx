'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { formatDate } from '@helvetly/ui/lib/format'
import {
  Archive,
  ArchiveRestore,
  Barcode,
  Copy,
  CopyPlus,
  Ellipsis,
  Hash,
  Package,
  Pencil,
  Percent,
  Ruler,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { loadProblemText } from '@/components/data/load-problem'
import { EditableValue, InlineTextEditor } from '@/components/inline-add'
import { translate } from '@/lib/i18n'
import { formatMoney, fromCents, toCents, VAT_CATEGORIES } from '@/lib/invoices'
import { useProduct, useSaveProduct, type Product } from '@/lib/products'

import { ArchivedBadge, ProductTypeBadge, unitLabel, unitShort, vatLabel } from './product-bits'

export type ProductCommand = 'edit' | 'duplicate' | 'archive' | 'delete'

function Row({
  icon: Icon,
  label,
  value,
  copy,
  onAdd,
  editor,
  editing = false,
  onEdit,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  copy?: string | null
  onAdd?: () => void
  /** Adds or changes the value in place, shown while `editing`; `onEdit` opens it. */
  editor?: ReactNode
  editing?: boolean
  onEdit?: () => void
}) {
  const add = onEdit ?? onAdd
  return (
    // min-h-11: an open editor's input and its focus ring keep clear of the separators.
    <div className="group/row flex min-h-11 items-center gap-3 border-t border-border/60 first:border-t-0">
      <Icon className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
      <span className="w-28 shrink-0 text-[13.5px] text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-[14px] break-words">
        {editor && editing ? (
          editor
        ) : onEdit && value ? (
          <EditableValue
            label={translate('edit6', { label: label })}
            onEdit={onEdit}
            className="-mx-1.5 w-[calc(100%+0.75rem)] px-1.5 py-1"
          >
            <span className="block truncate">{value}</span>
          </EditableValue>
        ) : (
          (value ??
          (add ? (
            <button
              type="button"
              onClick={add}
              className="cursor-pointer text-link underline underline-offset-2 hover:no-underline"
            >
              {translate('add2')}
              {label === label.toUpperCase() ? label : label.toLowerCase()}
            </button>
          ) : (
            <span className="text-muted-foreground">—</span>
          )))
        )}
      </span>
      {copy && !editing && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('copy3', { value1: label.toLowerCase() })}
          className="text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
          onClick={() =>
            void navigator.clipboard
              .writeText(copy)
              .then(() => toast.success(translate('copied', { label: label })))
          }
        >
          <Copy />
        </Button>
      )}
    </div>
  )
}

/** An identifier (SKU, GTIN) added and changed in place; without `save` the value is read-only and adding opens the form. */
function IdentifierRow({
  icon,
  label,
  value,
  placeholder,
  onAdd,
  save,
}: {
  icon: LucideIcon
  label: string
  value: string | null
  placeholder: string
  onAdd: () => void
  save?: (text: string) => Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  return (
    <Row
      icon={icon}
      label={label}
      copy={value}
      onAdd={onAdd}
      editing={editing}
      onEdit={save && (() => setEditing(true))}
      editor={
        save && (
          <InlineTextEditor
            label={label}
            initial={value ?? ''}
            placeholder={placeholder}
            mono
            save={save}
            onDone={() => setEditing(false)}
          />
        )
      }
      value={value && <span className="font-code">{value}</span>}
    />
  )
}

/** One catalogue item, in a sheet from the right (full screen on phones). */
export function ProductDetail({
  id,
  canManage,
  onClose,
  onCommand,
}: {
  id: string
  canManage: boolean
  onClose: () => void
  onCommand: (command: ProductCommand, product: Product) => void
}) {
  const query = useProduct(id)
  const product = query.data
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 overflow-y-auto bg-panel p-0 sm:w-[min(680px,100vw)]! dark:bg-background"
      >
        <SheetTitle className="sr-only">{product?.name ?? translate('product')}</SheetTitle>
        <SheetDescription className="sr-only">{translate('catalogueItemDetails')}</SheetDescription>
        {product ? (
          <Detail product={product} canManage={canManage} onClose={onClose} onCommand={onCommand} />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-[15px]">{translate('thisItemCouldnTBeLoaded')}</p>
            <p className="text-sm text-muted-foreground">
              {loadProblemText(query.error, translate('thisItem'))}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                {translate('tryAgain')}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                {translate('close')}
              </Button>
            </div>
          </div>
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Detail({
  product,
  canManage,
  onClose,
  onCommand,
}: {
  product: Product
  canManage: boolean
  onClose: () => void
  onCommand: (command: ProductCommand, product: Product) => void
}) {
  const edit = () => onCommand('edit', product)
  const saveProduct = useSaveProduct()
  /** One identifier saved from the page; without the right to change items the link opens the form. */
  const saveIdentifier = (field: 'sku' | 'gtin') =>
    canManage
      ? (text: string) => saveProduct.mutateAsync({ id: product.id, input: { [field]: text } })
      : undefined
  const unit = unitShort(product.unit)
  const category = VAT_CATEGORIES.find((entry) => entry.value === product.vat_category)
  const prices = [
    {
      label: translate('net2'),
      value: product.unit_price_net,
      entered: product.price_basis === 'net',
    },
    {
      label: translate('vat'),
      value: fromCents(toCents(product.unit_price_gross) - toCents(product.unit_price_net)),
      entered: false,
    },
    {
      label: translate('gross'),
      value: product.unit_price_gross,
      entered: product.price_basis === 'gross',
    },
  ]

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur">
        <div className="flex h-12 items-center gap-1 border-b border-border/60 px-3">
          {product.sku && (
            <Badge size="sm" className="font-code ml-1">
              {product.sku}
            </Badge>
          )}
          <span className="ml-1.5 text-[13px] text-muted-foreground">
            {product.type === 'product' ? translate('product') : translate('service')}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={translate('moreActions')}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onSelect={() => onCommand('duplicate', product)}>
                  <CopyPlus />
                  {translate('duplicate')}
                </DropdownMenuItem>
                {canManage && (
                  <>
                    <DropdownMenuItem onSelect={() => onCommand('archive', product)}>
                      {product.is_archived ? <ArchiveRestore /> : <Archive />}
                      {product.is_archived ? translate('restore') : translate('archive')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onCommand('delete', product)}
                    >
                      <Trash2 />
                      {translate('delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" className="gap-1.5" onClick={edit}>
              <Pencil className="size-3.5" />
              {translate('edit4')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={translate('close')}
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-4 border-b border-border/60 px-6 pt-5 pb-5">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-[#f4f3f6] to-[#e7e6eb] text-[#55545a] shadow-elevation-1 dark:from-muted dark:to-muted dark:text-muted-foreground"
          >
            {product.type === 'product' ? (
              <Package className="size-6 stroke-[1.5]" />
            ) : (
              <Wrench className="size-6 stroke-[1.5]" />
            )}
          </span>
          <div className="grid min-w-0 gap-1">
            <h2 className="text-[22px] leading-tight font-medium tracking-[-0.02em] break-words">
              {product.name}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <ProductTypeBadge type={product.type} />
              {product.is_archived && <ArchivedBadge />}
              <span className="text-[13.5px] text-muted-foreground tabular-nums">
                {formatMoney(
                  product.price_basis === 'gross'
                    ? product.unit_price_gross
                    : product.unit_price_net,
                  product.currency,
                )}
                {unit && ` / ${unit}`} ·{' '}
                {product.price_basis === 'gross' ? translate('inclVAT3') : translate('exclVAT2')}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid content-start gap-3 p-4 sm:p-5">
        <Panel title={translate('pricePerUnit')}>
          <div className="grid grid-cols-3 gap-2">
            {prices.map((price) => (
              <div key={price.label} className="grid gap-0.5 rounded-lg bg-muted/60 px-3 py-2.5">
                <span className="text-[12px] text-muted-foreground">
                  {price.label}
                  {price.entered && translate('entered')}
                </span>
                <span className="text-[15px] font-medium tabular-nums">
                  {formatMoney(price.value, product.currency)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Row
              icon={Percent}
              label={translate('vat')}
              value={
                <span>
                  {vatLabel(product)}
                  <span className="text-muted-foreground"> · {category?.hint}</span>
                </span>
              }
            />
            <Row
              icon={Ruler}
              label={translate('unit')}
              onAdd={edit}
              value={unitLabel(product.unit)}
            />
          </div>
        </Panel>

        <Panel title={translate('identifiers')}>
          <IdentifierRow
            icon={Hash}
            label="SKU"
            value={product.sku}
            placeholder={translate('webHOUR')}
            onAdd={edit}
            save={saveIdentifier('sku')}
          />
          {product.type === 'product' && (
            <IdentifierRow
              icon={Barcode}
              label="GTIN"
              value={product.gtin}
              placeholder="7612345678900"
              onAdd={edit}
              save={saveIdentifier('gtin')}
            />
          )}
        </Panel>

        <Panel title={translate('onTheInvoice')}>
          <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-[13.5px] leading-relaxed">
            <p className="font-medium">{product.name}</p>
            {product.description ? (
              <p className="whitespace-pre-wrap text-muted-foreground">{product.description}</p>
            ) : (
              <button
                type="button"
                onClick={edit}
                className="cursor-pointer text-link underline underline-offset-2 hover:no-underline"
              >
                {translate('addADescription')}
              </button>
            )}
          </div>
        </Panel>

        <p className="px-1 pt-1 text-xs text-muted-foreground">
          {translate('added2')}
          {formatDate(product.created_at)}
          {translate('updated')}
          {formatDate(product.updated_at)}
          {product.archived_at &&
            translate('archived2', { value1: formatDate(product.archived_at) })}
        </p>
      </div>
    </div>
  )
}

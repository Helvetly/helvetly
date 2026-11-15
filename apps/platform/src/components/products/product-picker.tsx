'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@helvetly/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Package, PackageSearch, Wrench } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { formatMoney, type VatMode } from '@/lib/invoices'
import { lineFromProduct, useProductSearch, type PickedLine, type Product } from '@/lib/products'

import { unitShort } from './product-bits'

/**
 * Picks a catalogue item and hands back the invoice line it becomes (docs/products-contract.md,
 * "Using it on an invoice"): the price matches `vatMode`, items in `currency` come first, and an
 * item in another currency says so instead of being converted.
 */
export function ProductPicker({
  currency,
  vatMode,
  onPick,
  trigger,
}: {
  currency: string
  vatMode: VatMode
  onPick: (line: PickedLine, product: Product) => void
  /** The button that opens the picker; defaults to "Add from catalogue". */
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 200)
    return () => clearTimeout(timer)
  }, [term])
  const search = useProductSearch(debounced, currency, open)
  const items = search.data ?? []

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setTerm('')
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="secondary" size="sm" className="w-fit">
            <PackageSearch />
            {translate('addFromCatalogue')}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false} label={translate('productsAndServices')}>
          <CommandInput
            placeholder={translate('searchNameSKUOrGTIN')}
            value={term}
            onValueChange={setTerm}
          />
          <CommandList>
            <CommandEmpty>
              {search.isPending
                ? translate('searching')
                : debounced
                  ? translate('nothingMatches4')
                  : translate('yourCatalogueIsEmpty')}
            </CommandEmpty>
            {items.length > 0 && (
              <CommandGroup
                heading={debounced ? translate('matches') : translate('recentlyUpdated')}
              >
                {items.map((product) => {
                  const line = lineFromProduct(product, vatMode)
                  const unit = unitShort(product.unit)
                  const foreign = product.currency !== currency
                  return (
                    <CommandItem
                      key={product.id}
                      value={product.id}
                      onSelect={() => {
                        onPick(line, product)
                        setOpen(false)
                        setTerm('')
                      }}
                      className="cursor-pointer items-start gap-2.5 py-2"
                    >
                      {product.type === 'product' ? (
                        <Package className="mt-0.5 text-muted-foreground" />
                      ) : (
                        <Wrench className="mt-0.5 text-muted-foreground" />
                      )}
                      <span className="grid min-w-0 flex-1 leading-snug">
                        <span className="break-words">{product.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {[product.sku, foreign && `in ${product.currency}`]
                            .filter(Boolean)
                            .join(' · ') ||
                            (product.type === 'product'
                              ? translate('product')
                              : translate('service'))}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[13px] whitespace-nowrap tabular-nums">
                        {formatMoney(line.unit_price, product.currency)}
                        {unit && <span className="text-muted-foreground"> / {unit}</span>}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

'use client'

import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'

import { usePaidPrepayments, type Invoice, type InvoiceListItem } from '@/lib/invoices'

import { Money } from './invoice-bits'

type Prepayment = Invoice['prepayments'][number]

const asRef = (item: InvoiceListItem): Prepayment => ({
  id: item.id,
  number: item.number,
  payable_total: item.payable_total,
})

/** "Deduct prepayments": the client's paid prepayment invoices in the draft's currency. */
export function PrepaymentPicker({
  clientId,
  currency,
  value,
  onChange,
}: {
  clientId: string
  currency: string
  value: Prepayment[]
  onChange: (prepayments: Prepayment[]) => void
}) {
  const list = usePaidPrepayments(clientId)
  const paid = (list.data?.pages.flatMap((page) => page.data) ?? [])
    .filter((item) => item.currency === currency && !item.deducted_on)
    .map(asRef)
  // Chosen ones stay visible (and can be unticked) even when the list no longer offers them.
  const options = [...value.filter((chosen) => !paid.some((p) => p.id === chosen.id)), ...paid]
  const chosen = new Set(value.map((prepayment) => prepayment.id))
  const toggle = (prepayment: Prepayment, on: boolean) =>
    onChange(on ? [...value, prepayment] : value.filter((entry) => entry.id !== prepayment.id))

  return (
    <section aria-labelledby="deduct-prepayments" className="grid gap-1.5 rounded-xl px-1">
      <h2 id="deduct-prepayments" className="text-[13px] font-medium text-muted-foreground">
        Deduct prepayments
      </h2>
      {options.length ? (
        <ul className="grid gap-1">
          {options.map((prepayment) => (
            <li key={prepayment.id}>
              <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[14px] hover:bg-muted/50">
                <Checkbox
                  checked={chosen.has(prepayment.id)}
                  onCheckedChange={(checked) => toggle(prepayment, checked === true)}
                />
                <span className="min-w-0 flex-1 truncate">
                  Prepayment {prepayment.number ?? 'draft'}
                </span>
                <Money value={prepayment.payable_total} currency={currency} />
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2 text-[13px] text-muted-foreground">
          {list.isLoading
            ? 'Loading…'
            : `No paid prepayment invoices for this client in ${currency}.`}
        </p>
      )}
      {list.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Loading…' : 'Load more prepayments'}
        </Button>
      )}
    </section>
  )
}

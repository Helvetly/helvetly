'use client'
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@helvetly/ui/components/command'
import { useState } from 'react'

import { translate } from '@/lib/i18n'
import {
  formatDay,
  kindInfo,
  useIssuedInvoices,
  type InvoiceKind,
  type InvoiceListItem,
} from '@/lib/invoices'

import { InvoiceNumber, Money, RowStatus } from './invoice-bits'
import { availableCommands } from './invoice-commands'

/** The documents made from an issued invoice, and the command that makes each. */
export const DERIVED = [
  { kind: 'credit_note', command: 'credit_note' },
  { kind: 'debit_note', command: 'debit_note' },
  { kind: 'corrected', command: 'correct' },
] as const satisfies { kind: InvoiceKind; command: string }[]
export type DeriveFrom = (typeof DERIVED)[number]

/** Whether `invoice` can be the source of `derived`, by the same rules as its own menu. */
const derivesFrom = (derived: DeriveFrom, invoice: InvoiceListItem) =>
  availableCommands(invoice, false)[derived.command]

/** Picks the issued invoice a credit note, debit note or correction is made from. */
export function DerivePicker({
  derived,
  onPick,
  onClose,
}: {
  derived: DeriveFrom
  onPick: (invoice: InvoiceListItem) => void
  onClose: () => void
}) {
  const [term, setTerm] = useState('')
  const search = useIssuedInvoices(term)
  const rows = (search.data?.data ?? []).filter((invoice) => derivesFrom(derived, invoice))
  const label = kindInfo(derived.kind).label
  return (
    <CommandDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={label}
      description={translate('pickTheIssuedInvoiceItIsFor')}
      className="sm:max-w-xl"
    >
      {/* The server searches, so cmdk must not filter again. */}
      <Command shouldFilter={false} label={label}>
        <CommandInput
          value={term}
          onValueChange={setTerm}
          placeholder={translate('searchNumberOrClient')}
        />
        <CommandList className="max-h-96">
          <CommandGroup heading={translate('pickTheIssuedInvoiceItIsFor')}>
            {/* A disabled option, not cmdk's Empty: a listbox without options is invalid ARIA. */}
            {rows.length === 0 && (
              <CommandItem
                disabled
                value="__empty"
                className="grid justify-center gap-1 py-6 text-center text-muted-foreground data-[disabled=true]:opacity-100"
              >
                {search.isFetching ? (
                  translate('searching')
                ) : term ? (
                  translate('noIssuedInvoiceFound')
                ) : (
                  <>
                    <span className="font-medium text-foreground">
                      {translate('noIssuedInvoicesYet')}
                    </span>
                    {translate('issueAnInvoiceFirstThisDocumentAlwaysRefersToOne')}
                  </>
                )}
              </CommandItem>
            )}
            {rows.map((invoice) => (
              <CommandItem
                key={invoice.id}
                value={invoice.id}
                onSelect={() => onPick(invoice)}
                className="gap-3 py-2"
              >
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate font-medium">
                    <InvoiceNumber invoice={invoice} />
                  </span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {invoice.client.name} · {formatDay(invoice.issue_date)}
                  </span>
                </span>
                <Money value={invoice.total} currency={invoice.currency} />
                <span className="flex w-24 justify-end">
                  <RowStatus invoice={invoice} />
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

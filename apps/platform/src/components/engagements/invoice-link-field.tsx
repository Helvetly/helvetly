'use client'
import { useMemo } from 'react'

import { Combobox } from '@/components/clients/fields'
import { useUnlinkedInvoices } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { formatDay, formatMoney } from '@/lib/invoices'

/** Picks one of the client's invoices that belongs to no engagement yet; off until there is one to pick. */
export function InvoiceLinkField({
  id,
  clientId,
  value,
  onChange,
}: {
  id: string
  clientId: string
  value: string
  onChange: (invoiceId: string) => void
}) {
  const invoices = useUnlinkedInvoices(clientId)
  const options = useMemo(
    () =>
      (invoices.data ?? []).map((invoice) => ({
        value: invoice.id,
        label: invoice.number ?? translate('draft'),
        hint: `${formatDay(invoice.issue_date)} · ${formatMoney(invoice.total, invoice.currency)}`,
      })),
    [invoices.data],
  )
  const empty = options.length === 0
  return (
    <Combobox
      id={id}
      value={value}
      options={options}
      onChange={(next) => onChange(next === value ? '' : next)}
      disabled={empty}
      placeholder={
        !clientId
          ? translate('chooseAClientFirst')
          : empty && !invoices.isPending
            ? translate('noInvoicesToLink')
            : translate('chooseAnInvoice')
      }
      renderValue={(option) => `${option.label} · ${option.hint}`}
    />
  )
}

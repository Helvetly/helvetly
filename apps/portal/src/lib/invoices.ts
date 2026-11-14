import type { PortalInvoice } from '@/lib/portal'

/** Money still owed on it: an open invoice with something left to pay. */
export const isOpen = (invoice: PortalInvoice) =>
  invoice.status === 'open' && Number(invoice.amount_due) > 0

/** Positive sums per currency, as decimal strings; summed in minor units to stay exact. */
export function sumByCurrency(
  invoices: PortalInvoice[],
  amount: (invoice: PortalInvoice) => string,
): [currency: string, total: string][] {
  const cents = new Map<string, number>()
  for (const invoice of invoices)
    cents.set(
      invoice.currency,
      (cents.get(invoice.currency) ?? 0) + Math.round(Number(amount(invoice)) * 100),
    )
  return [...cents].filter(([, sum]) => sum > 0).map(([c, sum]) => [c, (sum / 100).toFixed(2)])
}

/** Open invoices, overdue first, then by due date (none last), then by number. */
export const byUrgency = (invoices: PortalInvoice[]) =>
  invoices
    .filter(isOpen)
    .toSorted(
      (a, b) =>
        Number(b.is_overdue) - Number(a.is_overdue) ||
        (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') ||
        a.number.localeCompare(b.number),
    )

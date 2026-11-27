import {
  addDays,
  fromCents,
  isPositive,
  toCents,
  type Decimal,
  type InvoiceListItem,
} from '@/lib/invoices'

/** The money groups of "Needs attention", in the order the card shows them. */
export const MONEY_GROUPS = ['overdue', 'instalments', 'refunds', 'dueSoon'] as const
export type MoneyGroup = (typeof MONEY_GROUPS)[number]

type Instalment = NonNullable<InvoiceListItem['open_instalments']>[number]

export type MoneyRow = {
  invoice: InvoiceListItem
  due: string
  amount: Decimal
  instalment: Instalment | null
}

/** An open invoice due within this many days is "due soon"; later ones wait in the invoice list. */
export const DUE_SOON_DAYS = 14

/**
 * Open invoices and refunds as rows per group, the most urgent first within each: every overdue
 * instalment (else the next one while it is due soon), refunds owed, overdue invoices and those
 * due within two weeks.
 */
export function moneyGroups(invoices: InvoiceListItem[], now: string) {
  const soon = addDays(now, DUE_SOON_DAYS)
  const groups: Record<MoneyGroup, MoneyRow[]> = {
    overdue: [],
    instalments: [],
    refunds: [],
    dueSoon: [],
  }
  for (const invoice of invoices) {
    if (isPositive(invoice.refund_due)) {
      groups.refunds.push({
        invoice,
        due: invoice.due_date,
        amount: invoice.refund_due,
        instalment: null,
      })
      continue
    }
    const items = invoice.open_instalments ?? []
    if (items.length > 0) {
      const overdue = items.filter((item) => item.is_overdue)
      // An invoice overdue as a whole keeps its next instalment on the list, however far off.
      const next = items.slice(0, 1).filter((i) => invoice.is_overdue || i.due_date <= soon)
      const shown = overdue.length > 0 ? overdue : next
      for (const instalment of shown)
        groups.instalments.push({
          invoice,
          due: instalment.due_date,
          amount: instalment.open,
          instalment,
        })
      continue
    }
    const row = { invoice, due: invoice.due_date, amount: invoice.amount_due, instalment: null }
    if (invoice.is_overdue) groups.overdue.push(row)
    else if (invoice.due_date <= soon) groups.dueSoon.push(row)
  }
  for (const rows of Object.values(groups)) rows.sort((a, b) => a.due.localeCompare(b.due))
  return groups
}

/** A group's total per currency, the largest first: one entry for a workspace in one currency. */
export function totalsByCurrency(rows: MoneyRow[]): { currency: string; amount: Decimal }[] {
  const sums = new Map<string, bigint>()
  for (const { invoice, amount } of rows)
    sums.set(invoice.currency, (sums.get(invoice.currency) ?? 0n) + toCents(amount))
  return [...sums]
    .toSorted(([, a], [, b]) => (b > a ? 1 : b < a ? -1 : 0))
    .map(([currency, cents]) => ({ currency, amount: fromCents(cents) }))
}

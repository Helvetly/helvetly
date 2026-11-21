// The ledger rows booking an expense makes (ledgercalc.Post), for the detail's preview; the payment's rows are left out.
import type { Expense } from '@/lib/expenses'
import { toCents } from '@/lib/invoices'

/** Supplier invoices (Kreditoren) and the input-tax accounts of the Swiss SME chart the API books to. */
export const PAYABLES = '2000'
const vatAccount = (account: string) => (account.startsWith('4') ? '1170' : '1171')

export type Posting = { debit: string; credit: string; amount: string }

const money = (cents: bigint) => {
  const sign = cents < 0n ? '-' : ''
  const abs = cents < 0n ? -cents : cents
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

/** Splits `total` by `weights`, the remainder on the last share, so no cent is lost. */
function share(total: bigint, weights: bigint[]) {
  const sum = weights.reduce((a, b) => a + b, 0n)
  if (sum === 0n) return weights.map((_, i) => (i === weights.length - 1 ? total : 0n))
  const parts = weights.slice(0, -1).map((weight) => (total * weight) / sum)
  return [...parts, total - parts.reduce((a, b) => a + b, 0n)]
}

/**
 * In the base currency: per account (an item's own category, else the expense's), the cost without the reclaimable
 * VAT to the account and the reclaimable VAT to input tax, each against payables. Empty without a category.
 */
export function postingPreview(expense: Expense): Posting[] {
  const fallback = expense.category?.account_code
  const weights = new Map<string, bigint>()
  for (const line of expense.lines) {
    const account = line.category?.account_code ?? fallback
    if (!account) return []
    weights.set(account, (weights.get(account) ?? 0n) + toCents(line.amount))
  }
  if (!weights.size && fallback) weights.set(fallback, 1n)
  const accounts = [...weights.keys()]
  const deductible = toCents(expense.base.deductible_vat)
  const costs = share(toCents(expense.base.total) - deductible, [...weights.values()])
  const vats = share(deductible, [...weights.values()])
  return accounts.flatMap((account, i) => [
    { debit: account, credit: PAYABLES, amount: money(costs[i] ?? 0n) },
    ...(vats[i] ? [{ debit: vatAccount(account), credit: PAYABLES, amount: money(vats[i]) }] : []),
  ])
}

import { StatusBadge } from '@helvetly/ui/components/status-badge'

import { expenseState, type Expense } from '@/lib/expenses'

export function ExpenseBadge({ expense }: { expense: Expense }) {
  const { label, tone } = expenseState(expense)
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

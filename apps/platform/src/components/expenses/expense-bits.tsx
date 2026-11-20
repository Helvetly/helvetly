import { Badge } from '@helvetly/ui/components/badge'

import { expenseState, type Expense } from '@/lib/expenses'

export function ExpenseBadge({ expense }: { expense: Expense }) {
  const { label, tone } = expenseState(expense)
  return <Badge tone={tone}>{label}</Badge>
}

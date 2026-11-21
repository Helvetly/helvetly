import { Badge } from '@helvetly/ui/components/badge'

import { ApprovalBadge } from '@/components/invoices/invoice-bits'
import { expenseState, type Expense } from '@/lib/expenses'

/** A row's state, and a draft's approval beside it. */
export function ExpenseBadge({ expense }: { expense: Expense }) {
  const { label, tone } = expenseState(expense)
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={tone}>{label}</Badge>
      {expense.status === 'draft' && <ApprovalBadge state={expense.approval_state} />}
    </span>
  )
}

'use client'
import { formatDate } from '@helvetly/ui/lib/format'
import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'

import type { Expense } from '@/lib/expenses'
import { translate } from '@/lib/i18n'

/** A warning, never a block: another expense has the same supplier and receipt number. */
export function DuplicateWarning({ duplicate }: { duplicate: Expense['duplicate_of'] }) {
  if (!duplicate) return null
  return (
    <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px] text-amber-900 sm:col-span-2 dark:text-amber-200">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {translate('thisReceiptMayAlreadyBeRecordedAs')}{' '}
        <Link href={`/expenses?id=${encodeURIComponent(duplicate.id)}`} className="underline">
          {translate('expense')}
          {duplicate.number}
        </Link>
        {duplicate.date && translate('dynamicFrom3', { value1: formatDate(duplicate.date) })}
        {translate('checkBeforeBookingItTwice')}
      </span>
    </p>
  )
}

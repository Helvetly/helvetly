'use client'

import { formatDate } from '@helvetly/ui/lib/format'
import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'

import type { Expense } from '@/lib/expenses'

/** A warning, never a block: another expense has the same supplier and receipt number. */
export function DuplicateWarning({ duplicate }: { duplicate: Expense['duplicate_of'] }) {
  if (!duplicate) return null
  return (
    <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px] text-amber-900 sm:col-span-2 dark:text-amber-200">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>
        This receipt may already be recorded as{' '}
        <Link href={`/expenses?id=${encodeURIComponent(duplicate.id)}`} className="underline">
          expense #{duplicate.number}
        </Link>
        {duplicate.date && ` from ${formatDate(duplicate.date)}`}. Check before booking it twice.
      </span>
    </p>
  )
}

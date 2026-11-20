'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { BadgeCheck, ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { useApprovalInbox } from '@/lib/approvals'
import { translate } from '@/lib/i18n'
import { formatMoney, kindInfo } from '@/lib/invoices'

/**
 * "Needs my approval": the documents waiting for my decision, as a band under the tabs; a row opens its drawer.
 * Not there while nothing waits.
 */
export function ApprovalInbox({ onOpen }: { onOpen: (id: string) => void }) {
  const items = useApprovalInbox().data ?? []
  const [open, setOpen] = useState(true)
  if (items.length === 0) return null
  return (
    <section
      aria-labelledby="approval-inbox-title"
      data-testid="approval-inbox"
      className="border-b bg-muted/30 px-2 py-1.5 md:px-3"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="approval-inbox-list"
        onClick={() => setOpen(!open)}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body-sm font-medium hover:bg-muted/60"
      >
        <BadgeCheck aria-hidden className="size-4 text-warning" />
        <span id="approval-inbox-title">{translate('approvalInboxTitle')}</span>
        <Badge tone="amber" size="sm" className="tabular-nums">
          {items.length}
        </Badge>
        <ChevronDown
          aria-hidden
          className={cn(
            'ml-auto size-4 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <ul id="approval-inbox-list" className="grid gap-0.5 pb-1">
          {items.map((item) => (
            <li key={item.doc_id}>
              <button
                type="button"
                onClick={() => onOpen(item.doc_id)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block truncate text-body">{item.client_name}</span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {translate('approvalInboxMeta', {
                      kind: kindInfo(item.kind).label,
                      name: item.submitted_by.name,
                      date: formatDate(item.submitted_at),
                    })}
                  </span>
                </span>
                <span className="text-body tabular-nums">
                  {formatMoney(item.total, item.currency)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

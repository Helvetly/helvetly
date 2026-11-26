'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { BadgeCheck, ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { useOpenHref } from '@/components/record-link'
import { UserAvatar } from '@/components/user-avatar'
import { useApprovalInbox, type ApprovalDoc, type InboxItem } from '@/lib/approvals'
import { translate } from '@/lib/i18n'
import { formatMoney, kindInfo } from '@/lib/invoices'

/** The page an item opens on. */
const docOf = (item: InboxItem): ApprovalDoc =>
  item.doc_type === 'quote' ? 'quotes' : item.doc_type === 'expense' ? 'expenses' : 'invoices'

const kindLabel = (item: InboxItem) =>
  item.kind === 'expense'
    ? translate('expense2')
    : item.kind === 'quote'
      ? translate('quote2')
      : kindInfo(item.kind).label

/**
 * "Needs my approval": the documents waiting for my decision, as a band under the tabs; a row of this page's `doc`
 * opens its drawer, any other goes to its own page. Not there while nothing waits.
 */
export function ApprovalInbox({ doc, onOpen }: { doc: ApprovalDoc; onOpen: (id: string) => void }) {
  const items = useApprovalInbox().data ?? []
  const openHref = useOpenHref()
  const [open, setOpen] = useState(true)
  const openItem = (item: InboxItem) =>
    docOf(item) === doc
      ? onOpen(item.doc_id)
      : openHref(`/${docOf(item)}?id=${encodeURIComponent(item.doc_id)}`)
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
                onClick={() => openItem(item)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
              >
                <UserAvatar
                  name={item.submitted_by.name}
                  url={item.submitted_by.avatar_url}
                  className="size-6"
                />
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block truncate text-body">
                    {item.client_name || kindLabel(item)}
                  </span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {translate('approvalInboxMeta', {
                      kind: kindLabel(item),
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

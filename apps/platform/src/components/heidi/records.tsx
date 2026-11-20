'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { Meter } from '@helvetly/ui/components/meter'
import { formatMoney } from '@helvetly/ui/lib/format'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { Briefcase, ChevronRight, FileText, UserRound, type LucideIcon } from 'lucide-react'

import { ClientStatusBadge } from '@/components/clients/client-bits'
import { plain } from '@/components/engagements/engagement-bits'
import { useOpenHref } from '@/components/record-link'
import type { HeidiRecord } from '@/lib/heidi'
import { translate } from '@/lib/i18n'
import { STATUS_LABELS, UNITS } from '@/lib/invoices'

const ICONS: Record<HeidiRecord['kind'], LucideIcon> = {
  client: UserRound,
  invoice: FileText,
  engagement: Briefcase,
}

const PAGES: Record<HeidiRecord['kind'], string> = {
  client: '/clients',
  invoice: '/invoices',
  engagement: '/engagements',
}

const short = (unit: string) => UNITS.find((entry) => entry.value === unit)?.short ?? ''

/** "3.5 of 10 h used" */
export function progressText({
  used,
  available,
  unit,
}: {
  used: string
  available: string
  unit: string
}) {
  return translate('ofUsed', {
    value1: plain(used),
    value2: [plain(available), short(unit)].filter(Boolean).join(' '),
  })
}

/** The records as plain lines, so a copied answer keeps them. */
export function recordsText(records: HeidiRecord[]) {
  return records
    .map((record) => {
      const extra =
        record.kind === 'invoice'
          ? formatMoney(record.amount, record.currency)
          : record.kind === 'engagement' && record.progress
            ? progressText(record.progress)
            : ''
      return `- ${[record.title, record.detail, extra].filter(Boolean).join(' · ')}`
    })
    .join('\n')
}

function Trailing({ record }: { record: HeidiRecord }) {
  switch (record.kind) {
    case 'client':
      // An active client is the usual case and needs no badge.
      return record.status === 'active' ? null : (
        <ClientStatusBadge client={{ is_draft: record.status === 'draft', is_active: false }} />
      )
    case 'invoice':
      return (
        <span className="grid justify-items-end gap-0.5">
          <span className="text-body-sm font-medium tabular-nums">
            {formatMoney(record.amount, record.currency)}
          </span>
          <Badge tone={STATUS_TONES.invoice[record.status]}>{STATUS_LABELS[record.status]}</Badge>
        </span>
      )
    case 'engagement':
      return null
  }
}

/** The records an answer is about: a quiet list whose rows open each one in a drawer, in place. */
export function Records({ records }: { records: HeidiRecord[] }) {
  const openHref = useOpenHref()
  return (
    <ul className="mt-3 divide-y rounded-xl border bg-card">
      {records.map((record) => {
        const progress = record.kind === 'engagement' ? record.progress : undefined
        return (
          <li
            key={`${record.kind}:${record.id}`}
            // Rounded like the list, so a row's hover and focus ring fit its corners.
            className="first:[&>button]:rounded-t-[11px] last:[&>button]:rounded-b-[11px]"
          >
            <button
              type="button"
              onClick={() => openHref(`${PAGES[record.kind]}?id=${encodeURIComponent(record.id)}`)}
              className="group/record flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <IconTile icon={ICONS[record.kind]} variant="row" size="sm" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-body-sm font-medium text-foreground">
                  {record.title}
                </span>
                {record.detail && (
                  <span className="truncate text-caption text-muted-foreground">
                    {record.detail}
                  </span>
                )}
                {progress && Number(progress.available) > 0 && (
                  <span className="mt-1 grid gap-1">
                    <Meter
                      label={progressText(progress)}
                      value={Math.min(Number(progress.used), Number(progress.available) * 1.5)}
                      max={Number(progress.available)}
                    />
                    <span className="text-caption text-muted-foreground tabular-nums">
                      {progressText(progress)}
                    </span>
                  </span>
                )}
              </span>
              <Trailing record={record} />
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover/record:text-muted-foreground"
              />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

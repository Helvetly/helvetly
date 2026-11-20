'use client'
import { Button } from '@helvetly/ui/components/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { translate } from '@/lib/i18n'

/**
 * The one look of every list table, after the invoices list: pages keep their own rows and
 * columns and take their classes from here, so a header, row or cell never drifts per page.
 */
export const listTable = {
  /** Pages add their own breakpoint, e.g. `hidden @4xl:table`. */
  table: 'w-full table-fixed text-[15px]',
  head: 'h-11 border-b bg-muted/50 text-left text-[11px] tracking-[0.04em] text-muted-foreground uppercase',
  th: 'px-3 font-medium first:pl-5 last:pr-5',
  row: 'h-[58px] border-b border-border/50 transition-colors duration-150 last:border-0 hover:bg-muted/40 data-open:bg-muted/50 data-selected:bg-brand-surface/60 data-attention:not-data-selected:bg-warning-surface/50',
  td: 'truncate px-3 first:pl-5 last:pr-5',
  /**
   * The leading checkbox column, head and body. A fixed table spreads spare width over the sized
   * columns when none is auto, which pushed the first column away from the checkbox: so the main
   * text column (client, name, supplier) never takes a width.
   */
  select: 'w-10 pl-5',
  /** The trailing "…" column, head and body. */
  menu: 'w-12 pr-3 text-right',
  numeric: 'text-right tabular-nums',
  /** The phone list that replaces the table on narrow screens. */
  list: 'divide-y divide-border/70',
  item: 'flex items-center gap-3 px-4 py-3 data-selected:bg-brand-surface/60 data-attention:not-data-selected:bg-warning-surface/50',
}

type PageMeta = { page: number; page_size: number; total: number; total_pages: number }

/** The footer under a paged list: the range shown, then previous and next. */
export function Pager({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  return (
    <nav
      aria-label={translate('pages')}
      className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-[13px] text-muted-foreground md:px-5"
    >
      <span className="tabular-nums">
        {(meta.page - 1) * meta.page_size + 1}–{Math.min(meta.page * meta.page_size, meta.total)}
        {translate('of5')}
        {meta.total}
      </span>
      <span className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={translate('previousPage')}
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular-nums">
          {translate('page')}
          {meta.page}
          {translate('of5')}
          {Math.max(meta.total_pages, 1)}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={translate('nextPage')}
          disabled={meta.page >= meta.total_pages}
          onClick={() => onPage(meta.page + 1)}
        >
          <ChevronRight />
        </Button>
      </span>
    </nav>
  )
}

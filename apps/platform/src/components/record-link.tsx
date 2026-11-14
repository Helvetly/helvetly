'use client'

import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Maximize2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useContext, type ComponentProps, type MouseEvent } from 'react'

/** A record with a detail drawer of its own, which opens on top of whatever is on screen. */
export type RecordRef = {
  kind: 'invoice' | 'quote' | 'client' | 'engagement' | 'expense' | 'document' | 'signature'
  id: string
}

/** Where each kind's page shows its drawer: the path, the query key of the id and any fixed keys. */
const ROUTES: {
  kind: RecordRef['kind']
  path: string
  key: string
  fixed?: Record<string, string>
}[] = [
  { kind: 'invoice', path: '/invoices', key: 'id' },
  { kind: 'quote', path: '/quotes', key: 'id' },
  { kind: 'client', path: '/clients', key: 'id' },
  { kind: 'engagement', path: '/engagements', key: 'id' },
  { kind: 'expense', path: '/expenses', key: 'id' },
  { kind: 'document', path: '/documents', key: 'file' },
  { kind: 'signature', path: '/documents', key: 'request', fixed: { view: 'signatures' } },
]

const pathOf = (url: URL) => url.pathname.replace(/\/$/, '') || '/'

/** The record a link points at (`/invoices?id=…`), or null for anything else, such as a filtered list. */
export function parseRecordHref(href: string): RecordRef | null {
  const url = new URL(href, 'http://local')
  for (const route of ROUTES) {
    const id = url.searchParams.get(route.key)
    const fixed = Object.entries(route.fixed ?? {})
    if (
      route.path === pathOf(url) &&
      id &&
      [...url.searchParams.keys()].length === fixed.length + 1 &&
      fixed.every(([key, value]) => url.searchParams.get(key) === value)
    )
      return { kind: route.kind, id }
  }
  return null
}

/** The record's own page, with its drawer open. */
export function recordPageHref(record: RecordRef): string {
  const route = ROUTES.find((entry) => entry.kind === record.kind)
  if (!route) return '/'
  const query = new URLSearchParams({ ...route.fixed, [route.key]: record.id })
  return `${route.path}?${query}`
}

/**
 * The stack after opening `record` while `here` (path and query) is on screen: the page's own drawer
 * for it is uncovered, one already in the stack comes back to the top, anything else goes on top.
 */
export function nextStack(stack: RecordRef[], record: RecordRef, here: string): RecordRef[] {
  const page = new URL(here, 'http://local')
  // Other keys on the page (a folder, a filter) do not matter: its drawer shows the record already.
  const shown = ROUTES.some(
    (route) =>
      route.kind === record.kind &&
      route.path === pathOf(page) &&
      page.searchParams.get(route.key) === record.id,
  )
  if (shown) return []
  const index = stack.findIndex((entry) => entry.kind === record.kind && entry.id === record.id)
  return index >= 0 ? stack.slice(0, index + 1) : [...stack, record]
}

/** Inside a stacked drawer: its record's page, and closing every stacked drawer to go there. */
export const RecordPageContext = createContext<{ href: string; leave: () => void } | null>(null)

/**
 * In a drawer opened in place: a button to the record's full page (the stack closes, the page opens
 * its own drawer). Nothing on the record's own page, which is the full page already.
 */
export function RecordPageButton() {
  const page = useContext(RecordPageContext)
  if (!page) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={page.href} aria-label="Open full page" onClick={page.leave}>
            <Maximize2 />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Open full page</TooltipContent>
    </Tooltip>
  )
}

export const RecordDrawersContext = createContext<((record: RecordRef) => void) | null>(null)

// A new tab or window asked for with a modifier key or the middle button keeps the plain link.
const modified = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

/** A link that opens a record's drawer in place, stacked on the current one, instead of going to its page. */
export function RecordLink({
  href,
  onClick,
  ...props
}: ComponentProps<typeof Link> & { href: string }) {
  const open = useContext(RecordDrawersContext)
  return (
    <Link
      href={href}
      onClick={(event) => {
        onClick?.(event)
        const record = parseRecordHref(href)
        if (!open || !record || modified(event)) return
        event.preventDefault()
        open(record)
      }}
      {...props}
    />
  )
}

/** Opens a href from code: a record in place (see RecordLink), anything else as a page. */
export function useOpenHref() {
  const open = useContext(RecordDrawersContext)
  const router = useRouter()
  return (href: string) => {
    const record = parseRecordHref(href)
    if (open && record) open(record)
    else router.push(href)
  }
}

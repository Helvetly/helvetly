'use client'

import { defaultLocale, localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Maximize2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useContext, type ComponentProps, type MouseEvent } from 'react'

import { translate } from '@/lib/i18n'

/** A record with a detail drawer of its own, which opens on top of whatever is on screen. */
export type RecordRef = {
  kind:
    | 'invoice'
    | 'quote'
    | 'client'
    | 'engagement'
    | 'expense'
    | 'document'
    | 'signature'
    | 'session'
  id: string
}

/** A new record's form, opened over any page; `client` presets the client where the form takes one. */
export type CreateRef = {
  kind: 'invoice' | 'quote' | 'client' | 'engagement' | 'expense' | 'product'
  mode: 'new'
  client?: string
}

/** A draft invoice in the editor. */
export type EditRef = { kind: 'invoice'; mode: 'edit'; id: string }

/** Anything the app-level drawers show: a record, a new one's form or a draft's editor. */
export type DrawerRef = RecordRef | CreateRef | EditRef

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
  { kind: 'session', path: '/scheduling', key: 'session' },
]

/** Where each kind's page opens its new-record form: `key=value`, and the key of a preset client. */
const CREATE_ROUTES: {
  kind: CreateRef['kind']
  path: string
  key: string
  value: string
  client?: string
}[] = [
  { kind: 'invoice', path: '/invoices', key: 'compose', value: 'new', client: 'cclient' },
  { kind: 'quote', path: '/quotes', key: 'new', value: '1', client: 'client' },
  { kind: 'client', path: '/clients', key: 'new', value: '1' },
  { kind: 'engagement', path: '/engagements', key: 'new', value: '1' },
  { kind: 'expense', path: '/expenses', key: 'new', value: '1' },
  { kind: 'product', path: '/products', key: 'new', value: '1' },
]

const pathOf = (url: URL) => localizedHref(url.pathname, defaultLocale).replace(/\/$/, '') || '/'

/** True when `url` has exactly these query keys, no others. */
const onlyKeys = (url: URL, keys: string[]) =>
  [...url.searchParams.keys()].every((key) => keys.includes(key))

/** The new form or draft a link points at (`/clients?new=1`, `/invoices?compose=…`, `/invoices/new`). */
function parseFormHref(url: URL): CreateRef | EditRef | null {
  const path = pathOf(url)
  const query = url.searchParams
  // The older editor URLs; another invoice kind (?kind=partial…) stays with the page's own editor.
  if (
    path === '/invoices/new' &&
    onlyKeys(url, ['client', 'kind']) &&
    (query.get('kind') ?? 'invoice') === 'invoice'
  ) {
    const client = query.get('client')
    return client ? { kind: 'invoice', mode: 'new', client } : { kind: 'invoice', mode: 'new' }
  }
  const draft = path === '/invoices/edit' ? query.get('id') : null
  if (draft && onlyKeys(url, ['id'])) return { kind: 'invoice', mode: 'edit', id: draft }
  const compose = path === '/invoices' ? query.get('compose') : null
  if (compose && compose !== 'new' && onlyKeys(url, ['compose']))
    return { kind: 'invoice', mode: 'edit', id: compose }
  for (const route of CREATE_ROUTES) {
    if (route.path !== path || query.get(route.key) !== route.value) continue
    if (!onlyKeys(url, route.client ? [route.key, route.client] : [route.key])) return null
    const client = route.client && query.get(route.client)
    return client ? { kind: route.kind, mode: 'new', client } : { kind: route.kind, mode: 'new' }
  }
  return null
}

/** The record or form a link points at (`/invoices?id=…`, `/clients?new=1`), or null for anything else, such as a filtered list. */
export function parseRecordHref(href: string): DrawerRef | null {
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
  return parseFormHref(url)
}

/** The record's own page, with its drawer (or its form) open. */
export function recordPageHref(record: DrawerRef): string {
  if ('mode' in record && record.mode === 'edit')
    return `/invoices?${new URLSearchParams({ compose: record.id })}`
  if ('mode' in record) {
    const route = CREATE_ROUTES.find((entry) => entry.kind === record.kind)
    if (!route) return '/'
    const query = new URLSearchParams({ [route.key]: route.value })
    if (route.client && record.client) query.set(route.client, record.client)
    return `${route.path}?${query}`
  }
  const route = ROUTES.find((entry) => entry.kind === record.kind)
  if (!route) return '/'
  const query = new URLSearchParams({ ...route.fixed, [route.key]: record.id })
  return `${route.path}?${query}`
}

/** True when the page `here` is the one whose own drawer or form shows `record`. */
export function onOwnPage(record: DrawerRef, here: string) {
  return (
    pathOf(new URL(here, 'http://local')) ===
    pathOf(new URL(recordPageHref(record), 'http://local'))
  )
}

/** One stack entry as written in the address (`?drawer=invoice:inv_1&drawer=client:new`). */
export function drawerKey(record: DrawerRef): string {
  if (!('mode' in record)) return `${record.kind}:${record.id}`
  if (record.mode === 'edit') return `invoice:edit:${record.id}`
  return record.client ? `${record.kind}:new:${record.client}` : `${record.kind}:new`
}

/** The stack entry an address value stands for, or null for one that names nothing known. */
export function parseDrawerKey(value: string): DrawerRef | null {
  const [kind = '', first = '', second] = value.split(':')
  if (first === 'new') {
    const route = CREATE_ROUTES.find((entry) => entry.kind === kind)
    if (!route) return null
    return second
      ? { kind: route.kind, mode: 'new', client: second }
      : { kind: route.kind, mode: 'new' }
  }
  if (first === 'edit')
    return kind === 'invoice' && second ? { kind, mode: 'edit', id: second } : null
  const route = ROUTES.find((entry) => entry.kind === kind)
  return route && first && second === undefined ? { kind: route.kind, id: first } : null
}

/** The most drawers stacked at once; opening another replaces the top one. */
export const MAX_STACK = 4

/**
 * The stack after opening `record` while `here` (path and query) is on screen: the page's own drawer
 * for it is uncovered, one already in the stack comes back to the top, anything else goes on top
 * (in place of the top one once MAX_STACK are open).
 */
export function nextStack(stack: DrawerRef[], record: DrawerRef, here: string): DrawerRef[] {
  const page = new URL(here, 'http://local')
  // Other keys on the page (a folder, a filter) do not matter: its drawer shows the record already.
  const shown =
    !('mode' in record) &&
    ROUTES.some(
      (route) =>
        route.kind === record.kind &&
        route.path === pathOf(page) &&
        page.searchParams.get(route.key) === record.id,
    )
  if (shown) return []
  const key = drawerKey(record)
  const index = stack.findIndex((entry) => drawerKey(entry) === key)
  if (index >= 0) return stack.slice(0, index + 1)
  return [...stack.slice(0, MAX_STACK - 1), record]
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
          <Link href={page.href} aria-label={translate('openFullPage')} onClick={page.leave}>
            <Maximize2 />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{translate('openFullPage')}</TooltipContent>
    </Tooltip>
  )
}

export const RecordDrawersContext = createContext<((record: DrawerRef) => void) | null>(null)

/** The drawer around a link: shows another record in its own place, instead of stacking a drawer on it. */
export const RecordReplaceContext = createContext<((record: DrawerRef) => void) | null>(null)

// A new tab or window asked for with a modifier key or the middle button keeps the plain link.
const modified = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

/**
 * A link that opens a record's drawer in place, stacked on the current one, instead of going to its page;
 * `inPlace` shows it in the current drawer instead, where that drawer allows it.
 */
export function RecordLink({
  href,
  onClick,
  inPlace,
  ...props
}: ComponentProps<typeof Link> & { href: string; inPlace?: boolean }) {
  const stack = useContext(RecordDrawersContext)
  const replace = useContext(RecordReplaceContext)
  const open = (inPlace && replace) || stack
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

/**
 * Opens a href from code: a record or form in place (see RecordLink), anything else as a page;
 * `inPlace` shows it in the current drawer instead, where that drawer allows it.
 */
export function useOpenHref(inPlace = false) {
  const stack = useContext(RecordDrawersContext)
  const replace = useContext(RecordReplaceContext)
  const open = (inPlace && replace) || stack
  const router = useRouter()
  return (href: string) => {
    const record = parseRecordHref(href)
    if (open && record) open(record)
    else router.push(href)
  }
}

/** Opens a drawer over the current page, e.g. `useDrawers().open({ kind: 'invoice', mode: 'new' })`; without the app's drawers around, goes to its page. */
export function useDrawers() {
  const stack = useContext(RecordDrawersContext)
  const router = useRouter()
  return {
    open: (record: DrawerRef) => (stack ? stack(record) : router.push(recordPageHref(record))),
  }
}

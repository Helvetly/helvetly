'use client'

// The person's notifications and their settings, typed by hand from docs/notifications-contract.md.
// Served by Go; the handlers in src/mocks/notifications.ts are a test-only fake.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import {
  Bell,
  BookCheck,
  Building2,
  ClipboardCheck,
  CreditCard,
  FileSignature,
  ReceiptText,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

import { request, type ApiError } from '@/lib/api'

export type Notification = {
  id: string
  event: string
  category: string
  title: string
  body: string | null
  /** Who did it; null for Helvetly's own jobs. */
  actor: string | null
  /** Platform path the notification opens. */
  href: string
  created_at: string
  read: boolean
  read_at: string | null
}
export type NotificationPage = { data: Notification[]; unread: number; next: string | null }
export type NotificationChoice = {
  event: string
  category: string
  email: boolean
  in_app: boolean
  /** False: the event never emails, so there is no email switch. */
  email_available: boolean
}
export type NotificationPrefs = { email: string; mail_ready: boolean; events: NotificationChoice[] }

type Category = { label: string; icon: LucideIcon }

/** The categories in the server's order, each with its icon (the tile is neutral, the icon tells the type). */
export const CATEGORIES: Record<string, Category> = {
  invoices: {
    label: 'Invoices & payments',
    icon: ReceiptText,
  },
  clients: {
    label: 'Clients & portal',
    icon: Building2,
  },
  documents: {
    label: 'Documents & signatures',
    icon: FileSignature,
  },
  expenses: {
    label: 'Expenses',
    icon: Wallet,
  },
  engagements: {
    label: 'Engagements',
    icon: ClipboardCheck,
  },
  team: {
    label: 'Team',
    icon: Users,
  },
  billing: {
    label: 'Billing',
    icon: CreditCard,
  },
  books: {
    label: 'Books & VAT',
    icon: BookCheck,
  },
  ai: {
    label: 'AI import & Heidi',
    icon: Sparkles,
  },
}

const OTHER: Category = { label: 'Other', icon: Bell }
export const categoryOf = (category: string) => CATEGORIES[category] ?? OTHER

const MANAGERS = 'For owners and admins'
const YOURS = 'Requests you sent'

/** What each event is called in the settings; an event a newer server adds stays unlisted until named here. */
export const EVENT_LABELS: Record<string, { label: string; hint: string }> = {
  'invoice.paid': { label: 'Invoice paid', hint: MANAGERS },
  'invoice.partly_paid': { label: 'Invoice partly paid', hint: MANAGERS },
  'invoice.overdue': { label: 'Invoice overdue', hint: MANAGERS },
  'dunning.sent': { label: 'Payment reminder sent', hint: MANAGERS },
  'instalment.issued': { label: 'Instalment issued', hint: MANAGERS },
  'quote.accepted': { label: 'Quote accepted', hint: MANAGERS },
  'quote.declined': { label: 'Quote declined', hint: MANAGERS },
  'einvoice.delivery_failed': { label: 'E-invoice not delivered', hint: MANAGERS },
  'einvoice.delivered': { label: 'E-invoice delivered', hint: MANAGERS },
  'client.change_requested': { label: 'Client change request', hint: MANAGERS },
  'portal.first_sign_in': { label: 'First portal sign-in', hint: MANAGERS },
  'portal.document_viewed': { label: 'Shared document opened', hint: 'Documents you shared' },
  'signature.viewed': { label: 'Signature request opened', hint: YOURS },
  'signature.signed': { label: 'Someone signed', hint: YOURS },
  'signature.completed': { label: 'Document signed', hint: YOURS },
  'signature.declined': { label: 'Signature declined', hint: YOURS },
  'expense.reimbursed': { label: 'Expense reimbursed', hint: 'Expenses you paid' },
  'engagement.draft_created': { label: 'Engagement draft ready', hint: MANAGERS },
  'engagement.over_committed': { label: 'Engagement over commitment', hint: MANAGERS },
  'member.invited': { label: 'Someone invited', hint: MANAGERS },
  'member.joined': { label: 'Someone joined', hint: MANAGERS },
  'member.role_changed': { label: 'Your role changed', hint: 'About you' },
  'member.removed': { label: 'Someone removed', hint: MANAGERS },
  'billing.trial_ending': { label: 'Trial ending', hint: 'For owners' },
  'billing.payment_failed': { label: 'Subscription payment failed', hint: 'For owners' },
  'billing.subscription_changed': { label: 'Subscription changed', hint: 'For owners' },
  'billing.limit_near': { label: 'Plan limit nearly reached', hint: MANAGERS },
  'period.closed': { label: 'Month closed', hint: MANAGERS },
  'period.reopened': { label: 'Month reopened', hint: MANAGERS },
  'vat.return_due': { label: 'VAT return due', hint: MANAGERS },
  'import.ready': { label: 'Import ready to review', hint: 'Imports you started' },
  'import.failed': { label: 'Import failed', hint: 'Imports you started' },
}

/** How long a read notification stays in the bell's bubble; the Notifications page keeps it. */
export const BUBBLE_KEEP_MS = 5 * 60_000

export type NotificationFilter = { unread: boolean; category: string | null }

const notificationsKey = ['notifications'] as const
const bubbleKey = ['notifications', 'bubble'] as const
const pagesKey = (filter: NotificationFilter) => ['notifications', 'pages', filter] as const
const prefsKey = ['account', 'notifications'] as const

/** The query string of one request; read_after is taken from the clock when the request goes out. */
export function listQuery({
  before,
  limit = 20,
  unread,
  category,
  bubble,
}: Partial<NotificationFilter> & { before?: string | null; limit?: number; bubble?: boolean }) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (before) query.set('before', before)
  if (unread) query.set('unread', 'true')
  if (category) query.set('category', category)
  if (bubble) query.set('read_after', new Date(Date.now() - BUBBLE_KEEP_MS).toISOString())
  return query
}

const list = (query: URLSearchParams) => request<NotificationPage>(`/notifications?${query}`)

/** The bell: unread notifications and those read in the last minutes, with the unread count, every minute. */
export function useLatestNotifications() {
  return useQuery({
    queryKey: bubbleKey,
    queryFn: () => list(listQuery({ limit: 10, bubble: true })),
    refetchInterval: 60_000,
  })
}

/** The Notifications page: newest first, a page at a time, filtered. */
export function useNotificationPages(filter: NotificationFilter) {
  return useInfiniteQuery({
    queryKey: pagesKey(filter),
    queryFn: ({ pageParam }) => list(listQuery({ ...filter, before: pageParam })),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
  })
}

type Cached = NotificationPage | InfiniteData<NotificationPage, string | null>

/** Applies a change to every cached list: the bubble and every filter of the page. */
function updateLists(
  queryClient: QueryClient,
  change: (page: NotificationPage) => NotificationPage,
) {
  queryClient.setQueriesData<Cached>({ queryKey: notificationsKey }, (data) =>
    !data ? data : 'pages' in data ? { ...data, pages: data.pages.map(change) } : change(data),
  )
}

/** Marks every notification read: the dots and the count clear at once. */
export function useMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, void>({
    mutationFn: () => request('/notifications/read', { method: 'POST' }),
    onSuccess: () => {
      const now = new Date().toISOString()
      updateLists(queryClient, (page) => ({
        ...page,
        unread: 0,
        data: page.data.map((n) => (n.read ? n : { ...n, read: true, read_at: now })),
      }))
    },
  })
}

/** Marks one notification read or unread, at once in every list; a failure reloads them. */
export function useSetRead() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, { id: string; read: boolean }>({
    mutationFn: ({ id, read }) =>
      request(`/notifications/${encodeURIComponent(id)}/${read ? 'read' : 'unread'}`, {
        method: 'POST',
      }),
    onMutate: ({ id, read }) => {
      let changed = false
      const now = new Date().toISOString()
      updateLists(queryClient, (page) => {
        const hit = page.data.find((n) => n.id === id)
        if (!hit || hit.read === read) return page
        changed = true
        return {
          ...page,
          data: page.data.map((n) =>
            n.id === id ? { ...n, read, read_at: read ? (n.read_at ?? now) : null } : n,
          ),
        }
      })
      // The count is the server's total: move it once, whichever list held the item.
      if (changed)
        updateLists(queryClient, (page) => ({
          ...page,
          unread: Math.max(0, page.unread + (read ? -1 : 1)),
        }))
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: notificationsKey }),
  })
}

/** Loads the lists again (when the bell closes). */
export function useRefreshNotifications() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: notificationsKey })
}

export function useNotificationPrefs() {
  return useQuery({
    queryKey: prefsKey,
    queryFn: () => request<NotificationPrefs>('/account/notifications'),
  })
}

export function useSaveNotificationPrefs() {
  const queryClient = useQueryClient()
  return useMutation<NotificationPrefs, ApiError, NotificationChoice[]>({
    mutationFn: (events) =>
      request('/account/notifications', {
        method: 'PUT',
        json: { events: events.map(({ event, email, in_app }) => ({ event, email, in_app })) },
      }),
    onSuccess: (prefs) => queryClient.setQueryData(prefsKey, prefs),
  })
}

/** The email's unsubscribe link: no session, the token is the credential. */
export const unsubscribe = (token: string) =>
  request<{ event: string }>('/public/notifications/unsubscribe', {
    method: 'POST',
    json: { token },
    public: true,
  })

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** Notifications (newest first) under Today, Yesterday, This week (from Monday) and Earlier. */
export function byDay(items: Notification[], now = new Date()) {
  const today = startOfDay(now)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const days: { label: string; items: Notification[] }[] = []
  for (const item of items) {
    const at = new Date(item.created_at)
    const label =
      at >= today ? 'Today' : at >= yesterday ? 'Yesterday' : at >= monday ? 'This week' : 'Earlier'
    const last = days.at(-1)
    if (last?.label === label) last.items.push(item)
    else days.push({ label, items: [item] })
  }
  return days
}

'use client'
import { languageTag } from '@helvetly/i18n'
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
import { translate } from '@/lib/i18n'

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
  /** The reader has something to do: the bell's "Needs you". */
  needs_you: boolean
  /** The button's label: what opening href does. */
  action: string
  /** What later settled one that needs you (the invoice was paid), shown in its place. */
  resolved: { title: string; body: string | null; action: string; created_at: string } | null
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
    label: translate('invoicesPayments'),
    icon: ReceiptText,
  },
  clients: {
    label: translate('clientsPortal'),
    icon: Building2,
  },
  documents: {
    label: translate('documentsSignatures'),
    icon: FileSignature,
  },
  expenses: {
    label: translate('expenses'),
    icon: Wallet,
  },
  engagements: {
    label: translate('engagements'),
    icon: ClipboardCheck,
  },
  team: {
    label: translate('team'),
    icon: Users,
  },
  billing: {
    label: translate('billing'),
    icon: CreditCard,
  },
  books: {
    label: translate('booksVAT'),
    icon: BookCheck,
  },
  ai: {
    label: translate('aiImportHeidi'),
    icon: Sparkles,
  },
}

const OTHER: Category = { label: translate('other'), icon: Bell }
export const categoryOf = (category: string) => CATEGORIES[category] ?? OTHER

const MANAGERS = translate('forOwnersAndAdmins')
const YOURS = translate('requestsYouSent')
const YOURS_APPROVALS = translate('approvalsYouAskedFor')

/** What each event is called in the settings; an event a newer server adds stays unlisted until named here. */
export const EVENT_LABELS: Record<string, { label: string; hint: string }> = {
  'invoice.paid': { label: translate('invoicePaid'), hint: MANAGERS },
  'invoice.partly_paid': { label: translate('invoicePartlyPaid'), hint: MANAGERS },
  'invoice.overdue': { label: translate('invoiceOverdue'), hint: MANAGERS },
  'dunning.sent': { label: translate('paymentReminderSent'), hint: MANAGERS },
  'instalment.issued': { label: translate('instalmentIssued'), hint: MANAGERS },
  'approval.requested': {
    label: translate('approvalRequested'),
    hint: translate('approvalRequestedHint'),
  },
  'approval.approved': { label: translate('approvalApprovedEvent'), hint: YOURS_APPROVALS },
  'approval.rejected': { label: translate('approvalRejectedEvent'), hint: YOURS_APPROVALS },
  'quote.accepted': { label: translate('quoteAccepted'), hint: MANAGERS },
  'quote.declined': { label: translate('quoteDeclined'), hint: MANAGERS },
  'einvoice.delivery_failed': { label: translate('eInvoiceNotDelivered'), hint: MANAGERS },
  'einvoice.delivered': { label: translate('eInvoiceDelivered'), hint: MANAGERS },
  'client.change_requested': { label: translate('clientChangeRequest'), hint: MANAGERS },
  'portal.first_sign_in': { label: translate('firstPortalSignIn'), hint: MANAGERS },
  'portal.domain_active': { label: translate('portalDomainActive'), hint: MANAGERS },
  'portal.domain_failed': { label: translate('portalDomainFailed'), hint: MANAGERS },
  'portal.domain_released': { label: translate('portalDomainReleased'), hint: MANAGERS },
  'portal.document_viewed': {
    label: translate('sharedDocumentOpened'),
    hint: translate('documentsYouShared'),
  },
  'signature.viewed': { label: translate('signatureRequestOpened'), hint: YOURS },
  'signature.signed': { label: translate('someoneSigned'), hint: YOURS },
  'signature.completed': { label: translate('documentSigned'), hint: YOURS },
  'signature.declined': { label: translate('signatureDeclined'), hint: YOURS },
  'expense.reimbursed': {
    label: translate('expenseReimbursed'),
    hint: translate('expensesYouPaid'),
  },
  'engagement.draft_created': { label: translate('engagementDraftReady'), hint: MANAGERS },
  'engagement.over_committed': { label: translate('engagementOverCommitment'), hint: MANAGERS },
  'member.invited': { label: translate('someoneInvited'), hint: MANAGERS },
  'member.joined': { label: translate('someoneJoined'), hint: MANAGERS },
  'member.role_changed': { label: translate('yourRoleChanged'), hint: translate('aboutYou') },
  'member.removed': { label: translate('someoneRemoved'), hint: MANAGERS },
  'billing.trial_ending': { label: translate('trialEnding'), hint: translate('forOwners') },
  'billing.payment_failed': {
    label: translate('subscriptionPaymentFailed'),
    hint: translate('forOwners'),
  },
  'billing.payment_disputed': { label: translate('paymentDisputed'), hint: MANAGERS },
  'billing.subscription_changed': {
    label: translate('subscriptionChanged'),
    hint: translate('forOwners'),
  },
  'billing.limit_near': { label: translate('planLimitNearlyReached'), hint: MANAGERS },
  'period.closed': { label: translate('monthClosed'), hint: MANAGERS },
  'period.reopened': { label: translate('monthReopened'), hint: MANAGERS },
  'vat.return_due': { label: translate('vatReturnDue'), hint: MANAGERS },
  'import.ready': { label: translate('importReadyToReview'), hint: translate('importsYouStarted') },
  'import.failed': { label: translate('importFailed'), hint: translate('importsYouStarted') },
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

/**
 * The bell: unread notifications and those read in the last minutes, with the unread count, every minute; `live`
 * (the open bubble) every 10 seconds, so what is settled elsewhere turns green in front of the reader. Coming back
 * to the tab loads it again at once.
 */
export function useLatestNotifications({ live = false } = {}) {
  return useQuery({
    queryKey: bubbleKey,
    queryFn: () => list(listQuery({ limit: 20, bubble: true })),
    refetchInterval: live ? 10_000 : 60_000,
    staleTime: 0,
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
      at >= today
        ? translate('today')
        : at >= yesterday
          ? translate('yesterday')
          : at >= monday
            ? translate('thisWeek')
            : translate('earlier')
    const last = days.at(-1)
    if (last?.label === label) last.items.push(item)
    else days.push({ label, items: [item] })
  }
  return days
}

/** The bubble's filters: everything, what still needs the reader, the rest. */
export type BellFilter = 'all' | 'needs' | 'updates'

/** Still waiting for the reader: needs them and nothing settled it yet. */
export const waiting = (n: Notification) => n.needs_you && !n.resolved

/** How many of the items each filter holds; a settled one no longer counts as needing you. */
export const bellCounts = (items: Notification[]): Record<BellFilter, number> => ({
  all: items.length,
  needs: items.filter(waiting).length,
  updates: items.filter((n) => !n.needs_you).length,
})

/** The bubble's sections for a filter: what needs you (settled ones stay, to show what happened), then updates. */
export function bellSections(items: Notification[], filter: BellFilter) {
  const sections = [
    {
      key: 'needs' as const,
      label: translate('needsYou'),
      items: items.filter((n) => n.needs_you),
    },
    {
      key: 'updates' as const,
      label: translate('updates'),
      items: items.filter((n) => !n.needs_you),
    },
  ]
  return sections.filter((s) => s.items.length > 0 && (filter === 'all' || filter === s.key))
}

/** The bubble's time: "now" within a minute, the time today, else the day ("18 Nov"). */
export function shortTime(iso: string, now = new Date()) {
  const at = new Date(iso)
  if (now.getTime() - at.getTime() < 60_000) return translate('now')
  return at >= startOfDay(now)
    ? at.toLocaleTimeString(languageTag, { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString(languageTag, { day: 'numeric', month: 'short' })
}

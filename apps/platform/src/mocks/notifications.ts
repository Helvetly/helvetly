// Test-only fake for the Go notification endpoints (docs/notifications-contract.md). Never registered in
// development or production.
import { http, HttpResponse } from 'msw'

import type { Notification, NotificationChoice, NotificationPrefs } from '@/lib/notifications'

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

export const sampleNotifications = (): Notification[] => [
  {
    id: 'ntf_6',
    event: 'invoice.paid',
    category: 'invoices',
    title: 'Invoice RE-2026-0042 was paid',
    body: "CHF 1'250.00 received from Muster AG.",
    actor: 'Lea Meier',
    href: '/invoices?id=inv_42',
    // Just now, so it is "Today" at any hour (an hour ago is yesterday just after midnight).
    created_at: ago(0),
    read: false,
    read_at: null,
  },
  {
    id: 'ntf_5',
    event: 'signature.signed',
    category: 'documents',
    title: 'Ana Keller signed “Service agreement”',
    body: 'One more signature to go.',
    actor: 'Ana Keller',
    href: '/documents?view=signatures&request=sig_1',
    created_at: ago(0),
    read: false,
    read_at: null,
  },
  {
    id: 'ntf_4',
    event: 'invoice.overdue',
    category: 'invoices',
    title: 'Invoice RE-2026-0037 is overdue',
    body: 'CHF 980.00 open from Beta GmbH, due 2026-11-03',
    actor: null,
    href: '/invoices?id=inv_37',
    created_at: ago(0),
    // Read a minute ago: still in the bubble.
    read: true,
    read_at: ago(1 / 60),
  },
  {
    id: 'ntf_3',
    event: 'import.ready',
    category: 'ai',
    title: 'Your expenses import is ready to review',
    body: '12 records found in 3 files.',
    actor: null,
    href: '/expenses?import=1',
    created_at: ago(26),
    read: true,
    read_at: ago(25),
  },
  {
    id: 'ntf_2',
    event: 'client.change_requested',
    category: 'clients',
    title: 'Muster AG asked to change their billing details',
    body: 'Hans Muster asked to change the billing details. Review the request on the client.',
    actor: 'Hans Muster',
    href: '/clients?id=cli_1',
    created_at: ago(30),
    read: true,
    read_at: ago(29),
  },
  {
    id: 'ntf_1',
    event: 'member.joined',
    category: 'team',
    title: 'Lea Meier joined the workspace',
    body: 'As admin',
    actor: 'Lea Meier',
    href: '/members',
    created_at: ago(24 * 9),
    read: true,
    read_at: ago(24 * 9),
  },
]

const choice = (
  event: string,
  category: string,
  email: boolean,
  email_available = true,
): NotificationChoice => ({ event, category, email, in_app: true, email_available })

const samplePrefs = (): NotificationPrefs => ({
  email: 'pete@helvetly.example',
  mail_ready: true,
  events: [
    choice('invoice.paid', 'invoices', true),
    choice('invoice.overdue', 'invoices', false),
    choice('member.joined', 'team', true),
    choice('signature.completed', 'documents', false, false),
    choice('signature.declined', 'documents', false, false),
  ],
})

let notifications = sampleNotifications()
let prefs = samplePrefs()

export function resetNotificationsMock(list = sampleNotifications()) {
  notifications = list
  prefs = samplePrefs()
}

const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status })

export const notificationHandlers = [
  http.get('/api/v1/notifications', ({ request }) => {
    const query = new URL(request.url).searchParams
    const limit = Number(query.get('limit') ?? '20')
    const before = query.get('before')
    const category = query.get('category')
    const readAfter = query.get('read_after')
    const matching = notifications.filter(
      (n) =>
        (query.get('unread') !== 'true' || !n.read) &&
        (!category || n.category === category) &&
        (!readAfter || !n.read_at || n.read_at > readAfter),
    )
    const start = before ? matching.findIndex((n) => n.id === before) + 1 : 0
    const data = matching.slice(start, start + limit)
    const more = start + limit < matching.length
    return HttpResponse.json({
      data,
      unread: notifications.filter((n) => !n.read).length,
      next: more ? (data.at(-1)?.id ?? null) : null,
    })
  }),
  http.post('/api/v1/notifications/read', () => {
    const now = new Date().toISOString()
    notifications = notifications.map((n) => (n.read ? n : { ...n, read: true, read_at: now }))
    return new HttpResponse(null, { status: 204 })
  }),
  http.post<{ id: string; state: string }>(
    '/api/v1/notifications/:id/:state',
    ({ params: { id, state } }) => {
      const read = state === 'read'
      const n = notifications.find((item) => item.id === id)
      if (!n || (!read && state !== 'unread')) return fail(404, 'not_found', 'Not found.')
      n.read = read
      n.read_at = read ? (n.read_at ?? new Date().toISOString()) : null
      return new HttpResponse(null, { status: 204 })
    },
  ),
  http.get('/api/v1/account/notifications', () => HttpResponse.json(prefs)),
  http.put<never, { events?: Omit<NotificationChoice, 'email_available'>[] }>(
    '/api/v1/account/notifications',
    async ({ request }) => {
      const { events = [] } = await request.json()
      if (events.some((c) => !prefs.events.some((p) => p.event === c.event)))
        return fail(422, 'validation_failed', 'Unknown event.')
      prefs = {
        ...prefs,
        events: prefs.events.map((p) => {
          const c = events.find((e) => e.event === p.event)
          return c ? { ...p, email: p.email_available && c.email, in_app: c.in_app } : p
        }),
      }
      return HttpResponse.json(prefs)
    },
  ),
  http.post<never, { token?: unknown }>(
    '/api/v1/public/notifications/unsubscribe',
    async ({ request }) => {
      const { token } = await request.json()
      return token === 'good-token'
        ? HttpResponse.json({ event: 'invoice.paid' })
        : fail(400, 'invalid_link', 'This unsubscribe link is not valid.')
    },
  ),
]

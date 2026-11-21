import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'

// The page keeps its filters in the URL: a tiny in-memory URL the router mock updates.
const url = vi.hoisted(() => {
  let search = ''
  const listeners = new Set<() => void>()
  return {
    get: () => search,
    set: (next: string) => {
      search = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (to: string) => url.set(to.includes('?') ? to.slice(to.indexOf('?') + 1) : ''),
    push: () => {},
  }),
  usePathname: () => '/notifications',
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(url.subscribe, url.get)),
}))

import {
  bellCounts,
  bellSections,
  rowStep,
  BUBBLE_KEEP_MS,
  byDay,
  listQuery,
  shortTime,
  type Notification,
} from '@/lib/notifications'
import {
  notificationHandlers,
  resetNotificationsMock,
  sampleNotifications,
} from '@/mocks/notifications'

import { groupState, groupSummary, NotificationPrefs } from './notification-prefs'
import { NotificationsBell } from './notifications-bell'
import { NotificationsPage } from './notifications-page'
import { NotificationPrefsDrawers } from './prefs-drawer'
import { UnsubscribePage } from './unsubscribe-page'

beforeEach(() => url.set(''))

let reads = 0
let one: string[] = []
let saved: unknown
const server = setupServer(
  http.post('/api/v1/notifications/read', () => {
    reads++
    return undefined
  }),
  http.post('/api/v1/notifications/:id/:state', ({ params }) => {
    one.push(`${String(params.id)}:${String(params.state)}`)
    return undefined
  }),
  http.put('/api/v1/account/notifications', async ({ request }) => {
    saved = await request.clone().json()
    return undefined
  }),
  ...notificationHandlers,
  // the page header reads the signed-in person's access
  http.get('/api/v1/session', () =>
    HttpResponse.json({
      user: { id: 'usr_1', name: 'Anna' },
      role: 'owner',
      scopes: ['*:*'],
      csrf_token: 't',
    }),
  ),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  resetNotificationsMock()
  reads = 0
  one = []
  saved = undefined
})
afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})
afterAll(() => server.close())

function renderWith(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** The sidebar's Notifications item, as the sidebar renders it. */
function renderBell() {
  renderWith(
    <TooltipProvider>
      <SidebarProvider>
        <NotificationsBell />
      </SidebarProvider>
    </TooltipProvider>,
  )
}

const at = (iso: string): Notification => ({
  id: iso,
  event: 'invoice.paid',
  category: 'invoices',
  title: iso,
  body: null,
  actor: null,
  href: '/',
  created_at: iso,
  read: true,
  read_at: iso,
  needs_you: false,
  action: 'View invoice',
  resolved: null,
})

test('byDay groups under Today, Yesterday, This week and Earlier and keeps the order', () => {
  // A Thursday: the week began on Monday the 9th.
  const now = new Date(2026, 10, 12, 12)
  const days = byDay(
    [
      at(new Date(2026, 10, 12, 9).toISOString()),
      at(new Date(2026, 10, 12, 1).toISOString()),
      at(new Date(2026, 10, 11, 23).toISOString()),
      at(new Date(2026, 10, 9, 8).toISOString()),
      at(new Date(2026, 10, 8, 20).toISOString()),
      at(new Date(2025, 10, 2, 8).toISOString()),
    ],
    now,
  )
  expect(days.map((d) => [d.label, d.items.length])).toEqual([
    ['Today', 2],
    ['Yesterday', 1],
    ['This week', 1],
    ['Earlier', 2],
  ])
})

test('the bubble asks for what was read in the last five minutes, by the clock at request time', () => {
  vi.useFakeTimers({ now: new Date('2026-11-10T12:00:00Z') })
  const query = listQuery({ limit: 10, bubble: true })
  expect(query.get('read_after')).toBe('2026-11-10T11:55:00.000Z')
  expect(BUBBLE_KEEP_MS).toBe(300_000)
  expect(listQuery({ unread: true, category: 'team' }).toString()).toBe(
    'limit=20&unread=true&category=team',
  )
})

test('the bubble counts and sections: a settled item stays under Needs you but no longer counts', () => {
  const overdue = { ...at('2026-11-10T09:00:00Z'), needs_you: true }
  const settled = {
    ...at('2026-11-10T08:00:00Z'),
    needs_you: true,
    resolved: {
      title: 'Paid',
      body: null,
      action: 'View invoice',
      created_at: '2026-11-10T10:00:00Z',
    },
  }
  const update = at('2026-11-10T07:00:00Z')
  const items = [overdue, settled, update]
  expect(bellCounts(items)).toEqual({ all: 3, needs: 1, updates: 1 })
  expect(bellSections(items, 'all').map((s) => [s.label, s.items.length])).toEqual([
    ['Needs you', 2],
    ['Updates', 1],
  ])
  expect(bellSections(items, 'updates').map((s) => s.label)).toEqual(['Updates'])
  expect(bellSections([update], 'needs')).toEqual([])
})

test('arrow keys, Home and End step through the rows and stop at the ends', () => {
  expect(rowStep('ArrowDown', -1, 3)).toBe(0)
  expect(rowStep('ArrowDown', 1, 3)).toBe(2)
  expect(rowStep('ArrowDown', 2, 3)).toBe(2)
  expect(rowStep('ArrowUp', -1, 3)).toBe(2)
  expect(rowStep('ArrowUp', 0, 3)).toBe(0)
  expect(rowStep('Home', 2, 3)).toBe(0)
  expect(rowStep('End', 0, 3)).toBe(2)
  expect(rowStep('Enter', 0, 3)).toBeNull()
  expect(rowStep('ArrowDown', -1, 0)).toBeNull()
})

test('the bubble shows "now" within a minute, the time today and the day before that', () => {
  const now = new Date(2026, 10, 12, 12, 0, 30)
  expect(shortTime(new Date(2026, 10, 12, 12, 0).toISOString(), now)).toBe('now')
  expect(shortTime(new Date(2026, 10, 12, 9, 5).toISOString(), now)).toMatch(/09.05/)
  expect(shortTime(new Date(2026, 10, 8, 9, 5).toISOString(), now)).toMatch(/8|Nov/)
})

test('the bell shows the count; opening it marks nothing read, groups and filters', async () => {
  const user = userEvent.setup()
  renderBell()
  expect(await screen.findByTestId('bell-count')).toHaveTextContent('2')
  await user.click(screen.getByRole('button', { name: 'Notifications', description: '2 unread' }))
  const dialog = await screen.findByRole('dialog')
  const needs = await within(dialog).findByRole('region', { name: 'Needs you' })
  // Read a minute ago: still here; read a day ago: only on the page.
  expect(within(needs).getByText(/RE-2026-0037 is overdue/)).toBeVisible()
  expect(within(dialog).queryByText(/expenses import/)).toBeNull()
  const updates = within(dialog).getByRole('region', { name: 'Updates' })
  expect(within(updates).getByText('Invoice RE-2026-0042 was paid')).toBeVisible()
  expect(within(dialog).getAllByText('New')).toHaveLength(2)
  expect(screen.getByTestId('bell-count')).toHaveTextContent('2')
  expect(reads).toBe(0)

  const filters = within(dialog).getByRole('group', { name: 'Show' })
  expect(within(filters).getByRole('button', { name: 'All 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await user.click(within(filters).getByRole('button', { name: 'Needs you 1' }))
  expect(within(dialog).queryByRole('region', { name: 'Updates' })).toBeNull()
  await user.click(within(filters).getByRole('button', { name: 'Updates 2' }))
  expect(within(dialog).queryByRole('region', { name: 'Needs you' })).toBeNull()

  expect(within(dialog).getByRole('link', { name: 'View all notifications' })).toHaveAttribute(
    'href',
    '/notifications',
  )
  const settings = within(dialog).getByRole('link', { name: 'Notification settings' })
  expect(settings).toHaveAttribute('href', '/notifications?prefs=1')
  // Whether email goes out too is in the settings button's tooltip.
  await user.hover(settings)
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Also sent by email')

  await user.click(within(dialog).getByRole('button', { name: 'Mark all as read' }))
  await waitFor(() => expect(screen.queryByTestId('bell-count')).toBeNull())
  expect(reads).toBe(1)
  expect(within(dialog).queryByText('New')).toBeNull()
  expect(within(dialog).getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
})

test("an item's row opens it, marks it read and closes the bubble", async () => {
  const user = userEvent.setup()
  renderBell()
  await user.click(await screen.findByRole('button', { name: /^Notifications/ }))
  const dialog = await screen.findByRole('dialog')
  await user.click(
    await within(dialog).findByRole('link', {
      name: 'Ana Keller signed “Service agreement”',
      description: /View the request/,
    }),
  )
  await waitFor(() => expect(one).toContain('ntf_5:read'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('the bell says when everything is caught up', async () => {
  resetNotificationsMock([])
  const user = userEvent.setup()
  renderBell()
  await user.click(screen.getByRole('button', { name: 'Notifications' }))
  expect(await screen.findByText('You’re all caught up')).toBeVisible()
  expect(screen.queryByTestId('bell-count')).toBeNull()
  expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
})

test('on a phone the sidebar item opens the notifications in a sheet, with the count', async () => {
  const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    Object.assign(new EventTarget(), {
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  )
  try {
    const user = userEvent.setup()
    renderBell()
    const button = await screen.findByRole('button', {
      name: 'Notifications',
      description: '2 unread',
    })
    expect(screen.getByTestId('bell-count')).toHaveTextContent('2')
    await user.click(button)
    const sheet = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(await within(sheet).findByRole('region', { name: 'Needs you' })).toBeVisible()
  } finally {
    matchMedia.mockRestore()
  }
})

function renderPage() {
  renderWith(
    <TooltipProvider>
      <SidebarProvider>
        <NotificationsPage />
      </SidebarProvider>
    </TooltipProvider>,
  )
}

test('the page lists by day, loads more by cursor and marks all read', async () => {
  resetNotificationsMock(
    Array.from({ length: 25 }, (_, i) => ({
      ...sampleNotifications()[0]!,
      id: `ntf_${i}`,
      title: `Paid ${i}`,
    })),
  )
  const user = userEvent.setup()
  renderPage()
  expect(await screen.findByRole('link', { name: 'Paid 0' })).toBeVisible()
  expect(screen.getByRole('region', { name: 'Today' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Paid 24' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Load more' }))
  expect(await screen.findByRole('link', { name: 'Paid 24' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled(),
  )
  expect(screen.queryAllByText('New')).toHaveLength(0)
  expect(reads).toBe(1)
})

test('the page lists every notification, unread ones with a dot, and toggles one read state', async () => {
  const user = userEvent.setup()
  renderPage()
  const lea = await screen.findByRole('link', { name: /Lea Meier joined/ })
  expect(screen.getByRole('link', { name: /RE-2026-0042 was paid/ })).toBeVisible()
  // No tabs and no category filter: one list.
  expect(screen.queryByRole('button', { name: /^Unread/ })).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'Categories' })).toBeNull()
  const row = lea.closest('li')
  if (!row) throw new Error('no row around the notification')
  expect(within(row).queryByText('New')).toBeNull()
  await user.click(within(row).getByRole('button', { name: 'Mark as unread' }))
  await waitFor(() => expect(one).toHaveLength(1))
  expect(one[0]).toMatch(/:unread$/)
  expect(within(row).getByText('New')).toBeInTheDocument()
})

test('the page shows a load error with a retry', async () => {
  server.use(
    http.get('/api/v1/notifications', () =>
      HttpResponse.json({ error: { code: 'boom', message: 'Server down.' } }, { status: 500 }),
    ),
  )
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Server down.')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('settings save the switches once and hide email where there is none', async () => {
  const user = userEvent.setup()
  renderWith(<NotificationPrefs />)
  const paidEmail = await screen.findByRole('switch', { name: 'Invoice paid: email' })
  expect(screen.queryByRole('switch', { name: 'Document signed: email' })).toBeNull()
  // Nothing changed yet: nothing to save.
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  await user.click(paidEmail)
  // Only the first group starts open.
  expect(screen.queryByRole('switch', { name: 'Document signed: bell' })).toBeNull()
  await user.click(screen.getByRole('button', { name: /Documents & signatures/ }))
  await user.click(screen.getByRole('switch', { name: 'Document signed: bell' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled())
  expect(saved).toEqual({
    events: [
      { event: 'invoice.paid', email: false, in_app: true },
      { event: 'invoice.overdue', email: false, in_app: true },
      { event: 'member.joined', email: true, in_app: true },
      { event: 'signature.completed', email: false, in_app: false },
      { event: 'signature.declined', email: false, in_app: true },
    ],
  })
  expect(screen.getByRole('switch', { name: 'Invoice paid: email' })).not.toBeChecked()
  expect(screen.getByText('Saved')).toBeVisible()
})

test('a group shows its summary and a mixed group switch that turns the whole group on', async () => {
  const user = userEvent.setup()
  renderWith(<NotificationPrefs />)
  const invoices = await screen.findByRole('button', { name: /Invoices & payments/ })
  expect(invoices).toHaveAttribute('aria-expanded', 'true')
  expect(invoices).toHaveTextContent('1 of 2 by email · 2 of 2 in the bell')
  expect(screen.getByRole('button', { name: /Documents & signatures/ })).toHaveTextContent(
    'No email · 2 of 2 in the bell',
  )
  const every = screen.getByRole('checkbox', { name: 'Invoices & payments: every email' })
  expect(every).toHaveAttribute('aria-checked', 'mixed')
  await user.click(every)
  expect(every).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('switch', { name: 'Invoice overdue: email' })).toBeChecked()
  expect(invoices).toHaveTextContent('2 of 2 by email')
  await user.click(every)
  expect(screen.getByRole('switch', { name: 'Invoice paid: email' })).not.toBeChecked()
  // A collapsed group still switches as a whole, without opening.
  await user.click(screen.getByRole('checkbox', { name: 'Documents & signatures: every bell' }))
  await user.click(screen.getByRole('button', { name: /Documents & signatures/ }))
  expect(screen.getByRole('switch', { name: 'Document signed: bell' })).not.toBeChecked()
})

test.each([
  [[true, true], true],
  [[true, false], 'indeterminate'],
  [[false, false], false],
] as const)('groupState(%j) is %s', (values, want) => {
  expect(groupState([...values])).toBe(want)
})

const c = (email: boolean, in_app: boolean, email_available = true) => ({
  event: 'x',
  category: 'invoices',
  email,
  in_app,
  email_available,
})

test('groupSummary counts only events that can email', () => {
  expect(groupSummary([c(true, true), c(false, true), c(false, false, false)])).toBe(
    '1 of 2 by email · 2 of 3 in the bell',
  )
  expect(groupSummary([c(false, false, false)])).toBe('No email · 0 of 1 in the bell')
})

test('Preferences on the page opens the drawer in place', async () => {
  const user = userEvent.setup()
  renderWith(
    <TooltipProvider>
      <SidebarProvider>
        <NotificationPrefsDrawers>
          <NotificationsPage />
        </NotificationPrefsDrawers>
      </SidebarProvider>
    </TooltipProvider>,
  )
  const link = await screen.findByRole('link', { name: 'Preferences' })
  expect(link).toHaveAttribute('href', '/notifications?prefs=1')
  await user.click(link)
  const drawer = await screen.findByRole('dialog', { name: 'Notification preferences' })
  expect(await within(drawer).findByRole('switch', { name: 'Invoice paid: email' })).toBeVisible()
  // The address follows the drawer without a navigation, so the page under it never re-renders.
  expect(window.location.search).toBe('?prefs=1')
  await user.click(within(drawer).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog', { name: 'Notification preferences' })).toBeNull()
  expect(window.location.search).toBe('')
})

test('?prefs=1 in the address (old links, emails) opens the drawer; Esc closes it and clears the address', async () => {
  window.history.replaceState(null, '', '/notifications?prefs=1')
  url.set('prefs=1')
  renderWith(
    <TooltipProvider>
      <NotificationPrefsDrawers>
        <p>Page</p>
      </NotificationPrefsDrawers>
    </TooltipProvider>,
  )
  expect(await screen.findByRole('dialog', { name: 'Notification preferences' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Notification preferences' })).toBeNull()
  expect(window.location.search).toBe('')
  window.history.replaceState(null, '', '/')
})

test('unsubscribe posts the fragment token and says what stopped', async () => {
  window.location.hash = '#good-token'
  renderWith(<UnsubscribePage />)
  expect(await screen.findByRole('heading', { name: 'You’re unsubscribed' })).toBeVisible()
  expect(screen.getByText(/invoice paid/)).toBeVisible()
})

test('unsubscribe explains a bad or missing link', async () => {
  window.location.hash = '#forged'
  renderWith(<UnsubscribePage />)
  expect(await screen.findByText('This unsubscribe link is not valid.')).toBeVisible()
  window.location.hash = ''
})

test('settings from a server without categories still render, under one group with a key', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  server.use(
    http.get('/api/v1/account/notifications', () =>
      HttpResponse.json({
        email: 'anna@example.com',
        mail_ready: true,
        events: [
          { event: 'invoice.paid', email: true, in_app: true, email_available: true },
          { event: 'member.joined', email: true, in_app: true, email_available: true },
        ],
      }),
    ),
  )
  renderWith(<NotificationPrefs />)
  expect(await screen.findByRole('switch', { name: 'Invoice paid: email' })).toBeVisible()
  expect(screen.getByRole('switch', { name: 'Someone joined: email' })).toBeVisible()
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/unique "key"/)
  errors.mockRestore()
})

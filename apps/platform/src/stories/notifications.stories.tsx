import { Button } from '@helvetly/ui/components/button'
import { SidebarMenu, SidebarMenuItem, SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { focusManager } from '@tanstack/react-query'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { NotificationsBell } from '@/components/notifications/notifications-bell'
import { NotificationsPage } from '@/components/notifications/notifications-page'
import { NotificationPrefsDrawer } from '@/components/notifications/prefs-drawer'
import { UnsubscribePage } from '@/components/notifications/unsubscribe-page'
import { PageHeader } from '@/components/shell/page-header'
import { EVENT_LABELS } from '@/lib/notifications'
import {
  notificationHandlers,
  resetNotificationsMock,
  sampleNotifications,
  settleNotificationMock,
} from '@/mocks/notifications'

const meta = {
  title: 'Notifications',
  beforeEach: () => resetNotificationsMock(),
  parameters: { msw: { handlers: notificationHandlers } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const failing = (path: string) =>
  http.get(path, () =>
    HttpResponse.json({ error: { code: 'boom', message: 'Server down.' } }, { status: 500 }),
  )

const allRead = () => {
  const longAgo = new Date(Date.now() - 10 * 60_000).toISOString()
  return sampleNotifications().map((n) => Object.assign(n, { read: true, read_at: longAgo }))
}

const openBell = async (canvasElement: HTMLElement) => {
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: /^Notifications/ }),
  )
  const body = within(document.body)
  const dialog = await body.findByRole('dialog')
  // The popover fades in.
  await waitFor(() => expect(dialog).toBeVisible())
  return within(dialog)
}

// The sidebar's bottom group: Ask Heidi, then Notifications. `collapsed` is the icon rail.
const bell = ({ collapsed = false } = {}) => (
  <SidebarProvider className="min-h-0">
    <div
      data-collapsible={collapsed ? 'icon' : undefined}
      className={collapsed ? 'group w-12 p-2' : 'group w-64 p-2'}
    >
      <SidebarMenu>
        <SidebarMenuItem>
          <NotificationsBell />
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  </SidebarProvider>
)

/** Everything: what needs you first, then updates; opening marks nothing read, the button does. */
export const BellAll: Story = {
  render: () => bell(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('button', { name: 'Notifications', description: '2 unread' }),
    ).toBeVisible()
    await expect(canvas.getByTestId('bell-count')).toHaveTextContent('2')
    // Something unread: the bell rings now and then.
    await expect(canvas.getByTestId('bell-icon')).toHaveClass('bell-ring')
    const bubble = await openBell(canvasElement)
    // One compact row: the title, the filters and the icon button share it.
    const head = bubble.getByRole('heading', { name: 'Notifications' }).parentElement!
    await expect(head.getBoundingClientRect().height).toBeLessThanOrEqual(49)
    await expect(head).toContainElement(bubble.getByRole('button', { name: 'Mark all as read' }))
    const needs = await bubble.findByRole('region', { name: 'Needs you' })
    await expect(needs).toHaveTextContent(/RE-2026-0037 is overdue/)
    await expect(bubble.getByRole('region', { name: 'Updates' })).toHaveTextContent(
      /RE-2026-0042 was paid/,
    )
    await expect(bubble.getByRole('button', { name: 'All 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The unread ones keep their dot until read.
    await expect(bubble.getAllByText('New')).toHaveLength(2)
    await expect(canvas.getByTestId('bell-count')).toHaveTextContent('2')
    await userEvent.click(bubble.getByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(canvas.queryByTestId('bell-count')).toBeNull())
    await expect(bubble.queryByText('New')).toBeNull()
    // Nothing unread: the bell rests.
    await expect(canvas.getByTestId('bell-icon')).not.toHaveClass('bell-ring')
    await expect(bubble.getByRole('link', { name: 'View all notifications' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/notifications\/?$/),
    )
    await expect(bubble.getByRole('link', { name: 'Notification settings' })).toBeVisible()
  },
}

export const BellNeedsYou: Story = {
  render: () => bell(),
  play: async ({ canvasElement }) => {
    const bubble = await openBell(canvasElement)
    await userEvent.click(await bubble.findByRole('button', { name: 'Needs you 1' }))
    await expect(bubble.getByRole('region', { name: 'Needs you' })).toBeVisible()
    await expect(bubble.queryByRole('region', { name: 'Updates' })).toBeNull()
    await expect(
      bubble.getByRole('link', {
        name: 'Invoice RE-2026-0037 is overdue',
        description: /View invoice/,
      }),
    ).toBeVisible()
  },
}

export const BellUpdates: Story = {
  render: () => bell(),
  play: async ({ canvasElement }) => {
    const bubble = await openBell(canvasElement)
    await userEvent.click(await bubble.findByRole('button', { name: 'Updates 2' }))
    await expect(bubble.getByRole('region', { name: 'Updates' })).toHaveTextContent(
      /Ana Keller signed/,
    )
    await expect(bubble.queryByRole('region', { name: 'Needs you' })).toBeNull()
  },
}

/** Paid elsewhere while the bubble is open: the overdue item turns green and the Needs-you count drops. */
export const BellLiveResolve: Story = {
  render: () => bell(),
  play: async ({ canvasElement }) => {
    const bubble = await openBell(canvasElement)
    const needs = await bubble.findByRole('region', { name: 'Needs you' })
    await expect(within(needs).getByText(/RE-2026-0037 is overdue/)).toBeVisible()
    await expect(bubble.getByRole('button', { name: 'Needs you 1' })).toBeVisible()
    settleNotificationMock('ntf_4', {
      title: 'Invoice RE-2026-0037 was paid',
      body: 'CHF 980.00 received from Beta GmbH.',
      action: 'View invoice',
      created_at: new Date().toISOString(),
    })
    // Coming back to the tab loads at once (the open bubble also checks every 10 seconds).
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    const paid = await within(needs).findByText('Invoice RE-2026-0037 was paid')
    // It fades in.
    await waitFor(() => expect(paid).toBeVisible())
    await expect(within(needs).getByText('Settled')).toBeInTheDocument()
    await expect(bubble.getByRole('button', { name: 'Needs you' })).toBeVisible()
    focusManager.setFocused(undefined)
  },
}

const longTitle =
  'Your engagements import is ready to review, with records from every uploaded file'

/** A long title wraps inside the bubble instead of running off it, two lines at most. */
export const BellLongTitle: Story = {
  render: () => bell(),
  beforeEach: () =>
    resetNotificationsMock(
      sampleNotifications().map((n, i) => (i === 0 ? Object.assign(n, { title: longTitle }) : n)),
    ),
  play: async ({ canvasElement }) => {
    const bubble = await openBell(canvasElement)
    const title = await bubble.findByText(longTitle)
    await expect(title.getBoundingClientRect().height).toBeGreaterThan(20)
    await expect(title.getBoundingClientRect().height).toBeLessThan(44)
    await expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth)
  },
}

export const BellEmpty: Story = {
  render: () => bell(),
  beforeEach: () => resetNotificationsMock(allRead()),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('button', { name: 'Notifications' }),
    ).toBeVisible()
    const bubble = await openBell(canvasElement)
    await expect(await bubble.findByText('You’re all caught up')).toBeVisible()
    await expect(bubble.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
    // An empty filter shows no count.
    await userEvent.click(bubble.getByRole('button', { name: 'Needs you' }))
    await expect(bubble.getByText('Nothing needs you right now')).toBeVisible()
    await userEvent.click(bubble.getByRole('button', { name: 'Updates' }))
    await expect(bubble.getByText('No updates yet')).toBeVisible()
  },
}

/** Twelve unread: the list scrolls with a soft fade at its edges while the header and footer stay put. */
const twelve = () =>
  Array.from({ length: 12 }, (_, i) => {
    const n = sampleNotifications()[i % 5]!
    return Object.assign(n, { id: `ntf_many_${i}`, read: false, read_at: null })
  })

export const BellMany: Story = {
  render: () => bell(),
  beforeEach: () => resetNotificationsMock(twelve()),
  play: async ({ canvasElement }) => {
    const bubble = await openBell(canvasElement)
    await bubble.findAllByText(/RE-2026-0042 was paid/)
    const list = bubble.getByTestId('bell-list')
    await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    // Measure once the bubble has finished zooming in.
    const dialog = list.closest('[role=dialog]')!
    await Promise.all(dialog.getAnimations().map((a) => a.finished))
    const heading = bubble.getByRole('heading', { name: 'Notifications' })
    const footer = bubble.getByRole('link', { name: 'View all notifications' })
    const before = [heading.getBoundingClientRect().top, footer.getBoundingClientRect().top]
    list.scrollTop = list.scrollHeight
    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0))
    await expect([heading.getBoundingClientRect().top, footer.getBoundingClientRect().top]).toEqual(
      before,
    )
    // At the bottom only the top fades.
    const [top, bottom] = Array.from(list.parentElement!.querySelectorAll(':scope > [aria-hidden]'))
    await waitFor(() => expect(top).toHaveAttribute('data-on'))
    await expect(bottom).not.toHaveAttribute('data-on')
  },
}

export const BellManyDark: Story = { ...BellMany, parameters: { dark: true } }

/** The arrow keys walk the rows; Enter opens the focused one, marks it read and closes the bubble. */
export const BellKeyboard: Story = {
  render: () => bell(),
  play: async ({ canvasElement }) => {
    const bubble = await openBell(canvasElement)
    const rows = await bubble.findAllByRole('link', { description: /View/ })
    rows[0]!.focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(rows[1]).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(rows.at(-1)).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{Home}')
    await expect(rows[0]).toHaveFocus()
    // Focus never moves the row.
    const box = rows[0]!.getBoundingClientRect()
    await userEvent.keyboard('{ArrowDown}{ArrowUp}')
    await expect(rows[0]!.getBoundingClientRect()).toEqual(box)
  },
}

let drawerAsked = false

/** The whole row is the link: clicking it closes the bubble and opens the record in place (marking it read: the unit test). */
export const BellRowOpens: Story = {
  render: () => bell(),
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoices/inv_42', async () => {
          drawerAsked = true
          await delay('infinite')
        }),
        ...notificationHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    drawerAsked = false
    const bubble = await openBell(canvasElement)
    const body = await bubble.findByText("CHF 1'250.00 received from Muster AG.")
    // userEvent targets the element it is given: ask the page what a real click on the line would hit.
    const { left, top, width, height } = body.getBoundingClientRect()
    const hit = document.elementFromPoint(left + width / 2, top + height / 2)
    const link = bubble.getByRole('link', { name: 'Invoice RE-2026-0042 was paid' })
    await expect(hit).toBe(link)
    await userEvent.click(link)
    // The bubble closes and the invoice opens in place, in its drawer.
    await waitFor(() => expect(bubble.queryByRole('heading', { name: 'Notifications' })).toBeNull())
    await waitFor(() => expect(drawerAsked).toBe(true))
  },
}

/** Every rule that rings the bell sits under `prefers-reduced-motion: no-preference`: with reduced motion it rests. */
export const BellReducedMotion: Story = {
  render: () => bell(),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId('bell-count')).toBeVisible()
    const found: boolean[] = []
    const walk = (rules: CSSRuleList, allowed: boolean) => {
      for (const rule of Array.from(rules)) {
        const inside =
          allowed ||
          (rule instanceof CSSMediaRule &&
            rule.conditionText.includes('prefers-reduced-motion: no-preference'))
        if (rule instanceof CSSStyleRule && rule.selectorText.includes('.bell-ring'))
          found.push(inside)
        if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) walk(rule.cssRules, inside)
      }
    }
    for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules, false)
    await expect(found.length).toBeGreaterThan(0)
    await expect(found.every(Boolean)).toBe(true)
    const icon = within(canvasElement).getByTestId('bell-icon')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    await expect(getComputedStyle(icon).animationName).toBe(reduce ? 'none' : 'bell-ring')
  },
}

export const BellDark: Story = { ...BellAll, parameters: { dark: true } }

/** On a phone the bell opens the same notifications in a sheet from the bottom, the full width. */
export const BellPhone: Story = {
  render: () => bell(),
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: /^Notifications/ }),
    )
    const sheet = await within(document.body).findByRole('dialog', { name: 'Notifications' })
    await expect(await within(sheet).findByRole('region', { name: 'Needs you' })).toBeVisible()
    await waitFor(() => expect(sheet.getBoundingClientRect().width).toBe(window.innerWidth))
  },
}

export const BellError: Story = {
  render: () => bell(),
  // Only the list fails; the bell's preferences still answer.
  parameters: {
    msw: { handlers: [failing('/api/v1/notifications'), ...notificationHandlers] },
  },
  play: async ({ canvasElement }) => {
    const bubble = await openBell(canvasElement)
    await expect(await bubble.findByRole('alert')).toHaveTextContent('Server down.')
  },
}

export const BellCollapsed: Story = {
  render: () => bell({ collapsed: true }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Notifications', description: '2 unread' })
    // The count does not fit the icon rail: a green dot on the bell instead.
    await expect(canvas.getByTestId('bell-count')).not.toBeVisible()
    await expect(canvas.getByTestId('bell-dot')).toBeVisible()
  },
}

const Header = ({ width }: { width?: number }) => (
  <div style={{ width }} className="rounded-xl border">
    <SidebarProvider className="min-h-0">
      <PageHeader
        tabs={['All', 'Open']}
        primary="New invoice"
        onPrimary={() => {}}
        actions={<Button variant="outline">Create</Button>}
      />
    </SidebarProvider>
  </div>
)

/** The bell lives in the sidebar now; the top bar ends with the page's own buttons, a few px apart. */
export const HeaderWithoutBell: Story = {
  render: () => <Header />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const primary = await canvas.findByRole('button', { name: /New invoice/ })
    await expect(canvas.queryByRole('button', { name: /^Notifications/ })).toBeNull()
    const create = canvas.getByRole('button', { name: 'Create' })
    const gap = primary.getBoundingClientRect().left - create.getBoundingClientRect().right
    await expect(gap).toBeGreaterThanOrEqual(8)
  },
}

// Like the app's content panel: a column that is also the page's size container.
const page = () => (
  <SidebarProvider>
    <div className="@container flex min-w-0 flex-1 flex-col bg-background [&>header~*]:bg-card">
      <NotificationsPage />
    </div>
  </SidebarProvider>
)

export const Page: Story = {
  render: page,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('region', { name: 'Earlier' })).toBeVisible()
    const [newest] = canvas.getAllByRole('region', { name: /^(Today|Yesterday)$/ })
    await expect(newest).toBeVisible()
    await expect(canvas.getAllByText('New')).toHaveLength(2)
    await userEvent.click(canvas.getByRole('button', { name: 'Mark all as read' }))
    // The button is also disabled while the request is pending: wait for the dots themselves.
    await waitFor(() => expect(canvas.queryAllByText('New')).toHaveLength(0))
    await expect(canvas.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
  },
}

/** The page as a person first sees it, unread rows included. */
export const PageOverview: Story = { render: page, parameters: { ownMain: true } }

export const PageOverviewDark: Story = {
  ...PageOverview,
  parameters: { ownMain: true, dark: true },
}

export const PageMarkOneReadAndUnread: Story = {
  render: page,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('link', { name: /RE-2026-0042 was paid/ })
    const [first] = canvas.getAllByRole('button', { name: 'Mark as read' })
    await userEvent.click(first!)
    await waitFor(() => expect(canvas.getAllByText('New')).toHaveLength(1))
    const [again] = canvas.getAllByRole('button', { name: 'Mark as unread' })
    // The first change shows at once but its request may still run, which disables the button.
    await waitFor(() => expect(again).toBeEnabled())
    await userEvent.click(again!)
    await waitFor(() => expect(canvas.getAllByText('New')).toHaveLength(2))
  },
}

export const PageDark: Story = { ...Page, parameters: { dark: true } }

export const PageMobile: Story = {
  // The page lays out by its own width (the app's content panel is a size container).
  render: () => (
    <div style={{ width: 390 }} className="@container overflow-hidden">
      {page()}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('region', { name: 'Earlier' })).toBeVisible()
    // The header follows the viewport (the screenshots cover a real phone); the body follows its panel.
    const body = canvasElement.querySelector('header + div')
    await expect(body?.scrollWidth).toBeLessThanOrEqual(390)
  },
}

export const PageEmpty: Story = {
  render: page,
  beforeEach: () => resetNotificationsMock([]),
  play: async ({ canvasElement }) => {
    const title = await within(canvasElement).findByText('No notifications yet')
    await waitFor(() => expect(title).toBeVisible())
    await expect(
      within(canvasElement).getByRole('button', { name: 'Mark all as read' }),
    ).toBeDisabled()
  },
}

export const PageAllRead: Story = {
  render: page,
  beforeEach: () => resetNotificationsMock(allRead()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('region', { name: 'Earlier' })).toBeVisible()
    // Nothing unread: no blue dots, and Mark all as read has nothing to do.
    await expect(canvas.queryAllByText('New')).toHaveLength(0)
    await expect(canvas.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
  },
}

export const PageLoading: Story = {
  render: page,
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/notifications', async () => {
          await delay('infinite')
          return HttpResponse.json({})
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Mark all as read' }),
    ).toBeDisabled()
  },
}

export const PageError: Story = {
  render: page,
  parameters: { msw: { handlers: [failing('/api/v1/notifications')] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Server down.')
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

/** The preferences as people see them: the drawer over the page. */
const prefsDrawer = () => <NotificationPrefsDrawer onClose={() => {}} />

export const Settings: Story = {
  render: prefsDrawer,
  play: async () => {
    const canvas = within(document.body)
    const email = await canvas.findByRole('switch', { name: 'Invoice paid: email' })
    await expect(canvas.queryByRole('switch', { name: 'Document signed: email' })).toBeNull()
    await userEvent.click(email)
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled())
    await expect(canvas.getByRole('switch', { name: 'Invoice paid: email' })).not.toBeChecked()
  },
}

const categoryFor = (event: string) =>
  ({
    invoice: 'invoices',
    dunning: 'invoices',
    instalment: 'invoices',
    einvoice: 'invoices',
    client: 'clients',
    portal: 'clients',
    signature: 'documents',
    expense: 'expenses',
    engagement: 'engagements',
    member: 'team',
    billing: 'billing',
    period: 'books',
    vat: 'books',
    import: 'ai',
  })[event.split('.')[0] ?? ''] ?? 'other'

/** Every named event, spread over the groups as the server sends them (like a real account). */
const everyEvent = () => {
  return Object.keys(EVENT_LABELS).map((event, i) => ({
    event,
    category: categoryFor(event),
    email: i % 3 === 0,
    in_app: event !== 'signature.declined', // by name: a new event elsewhere does not reshuffle the groups
    email_available: !event.startsWith('signature.'),
  }))
}

const allGroups = {
  msw: {
    handlers: [
      http.get('/api/v1/account/notifications', () =>
        HttpResponse.json({
          email: 'pete@helvetly.example',
          mail_ready: true,
          events: everyEvent(),
        }),
      ),
      ...notificationHandlers,
    ],
  },
}

const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}

export const OpenInPlace: Story = {
  render: page,
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/signatures/sig_1', async () => {
          await delay('infinite')
        }),
        ...notificationHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = (await canvas.findByText('Ana Keller signed “Service agreement”')).closest('li')
    if (!row) throw new Error('The signature notification has no row.')
    await userEvent.click(within(row).getByRole('link', { name: 'Open' }))
    // The request's drawer opens over the page, with a way to its full page.
    const drawer = await within(document.body).findByRole('dialog', { name: 'Loading…' })
    await expect(
      within(drawer).getByRole('link', { name: 'Open full page' }).getAttribute('href'),
    ).toMatch(/^\/documents\/?\?view=signatures&request=sig_1$/)
    await expect(canvas.getByText('Ana Keller signed “Service agreement”')).toBeInTheDocument()
  },
}

export const SettingsGroups: Story = {
  render: prefsDrawer,
  parameters: allGroups,
  play: async () => {
    const canvas = within(document.body)
    const invoices = await canvas.findByRole('button', { name: /Invoices & payments/ })
    await expect(invoices).toHaveAttribute('aria-expanded', 'true')
    const documents = canvas.getByRole('button', { name: /Documents & signatures/ })
    await expect(documents).toHaveAttribute('aria-expanded', 'false')
    await expect(documents).toHaveTextContent('No email · 3 of 4 in the bell')
    const every = canvas.getByRole('checkbox', { name: 'Invoices & payments: every email' })
    await expect(every).toHaveAttribute('aria-checked', 'mixed')
    await userEvent.click(every)
    await expect(every).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('switch', { name: 'Invoice overdue: email' })).toBeChecked()
    // Keyboard: the header opens with Enter.
    documents.focus()
    await userEvent.keyboard('{Enter}')
    await expect(documents).toHaveAttribute('aria-expanded', 'true')
    await expect(await canvas.findByRole('switch', { name: 'Document signed: bell' })).toBeVisible()
  },
}

export const SettingsGroupsDark: Story = {
  render: prefsDrawer,
  parameters: { ...allGroups, dark: true },
  play: async () => {
    await within(document.body).findByRole('button', { name: /Invoices & payments/ })
  },
}

export const SettingsGroupsPhone: Story = {
  render: prefsDrawer,
  parameters: { ...allGroups, ...phone },
  globals: { viewport: { value: 'phone' } },
  play: async () => {
    const body = within(document.body)
    const every = await body.findByRole('checkbox', { name: 'Invoices & payments: every bell' })
    // The drawer fades in.
    await waitFor(() => expect(every).toBeVisible())
    await expect(body.getByRole('switch', { name: 'Invoice paid: bell' })).toBeVisible()
  },
}

export const SettingsWithoutMail: Story = {
  render: prefsDrawer,
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/account/notifications', () =>
          HttpResponse.json({
            email: 'pete@helvetly.example',
            mail_ready: false,
            events: [
              {
                event: 'invoice.paid',
                category: 'invoices',
                email: true,
                in_app: true,
                email_available: true,
              },
            ],
          }),
        ),
      ],
    },
  },
  play: async () => {
    const note = await within(document.body).findByText(/only the bell works/)
    // The drawer fades in.
    await waitFor(() => expect(note).toBeVisible())
  },
}

export const SettingsError: Story = {
  render: prefsDrawer,
  parameters: { msw: { handlers: [failing('/api/v1/account/notifications')] } },
  play: async () => {
    await expect(await within(document.body).findByRole('alert')).toHaveTextContent('Server down.')
  },
}

const withHash = (hash: string) => () => {
  window.location.hash = hash
  return () => {
    window.location.hash = ''
  }
}

export const Unsubscribed: Story = {
  render: () => <UnsubscribePage />,
  beforeEach: withHash('good-token'),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('heading', { name: 'You’re unsubscribed' }),
    ).toBeVisible()
  },
}

export const UnsubscribeInvalid: Story = {
  render: () => <UnsubscribePage />,
  beforeEach: withHash('forged'),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('This unsubscribe link is not valid.'),
    ).toBeVisible()
  },
}

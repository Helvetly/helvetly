import { SidebarInset, SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AuditLogSettings } from '@/components/settings/audit-log'
import { endedMonths, monthLabel, PeriodsSettings } from '@/components/settings/periods-settings'
import type { FinancialEvent, Period } from '@/lib/books'
import { today } from '@/lib/invoices'
import { auditEvents, sampleActivity } from '@/mocks/data'
import { filterAudit } from '@/mocks/handlers'

const session = (role: string) => ({
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role,
  // a member here views the books but has no edit right on them
  scopes: role === 'member' ? ['read:*'] : ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
})

const anna = { id: 'usr_story', name: 'Anna Muster' }
// Relative to today, so the stories never age: last month and the one before are closed.
const [lastMonth = '', twoMonthsAgo = '', threeMonthsAgo = ''] = endedMonths(today(), 3)
let periods: Period[] = []
const resetPeriods = () => {
  periods = [
    { month: lastMonth, closed_at: '2026-11-03T09:15:00Z', closed_by: anna },
    { month: twoMonthsAgo, closed_at: '2026-10-02T08:40:00Z', closed_by: null },
  ]
}

const periodHandlers = [
  http.get('/api/v1/periods', () => HttpResponse.json({ data: periods })),
  http.post<never, { month: string }>('/api/v1/periods', async ({ request }) => {
    const { month } = await request.json()
    const period = { month, closed_at: new Date().toISOString(), closed_by: anna }
    periods = [...periods, period]
    return HttpResponse.json({ data: period }, { status: 201 })
  }),
  http.get('/api/v1/periods/activity', ({ request }) => {
    const query = new URL(request.url).searchParams
    return HttpResponse.json({
      data: sampleActivity(query.get('from') ?? '', query.get('to') ?? ''),
    })
  }),
  http.post<{ month: string }>('/api/v1/periods/:month/reopen', ({ params }) => {
    periods = periods.filter((period) => period.month !== params.month)
    return HttpResponse.json({ data: { month: params.month } })
  }),
]

const auditHandlers = (events: FinancialEvent[], ok = true) => [
  http.get('/api/v1/audit-log', ({ request }) => {
    const query = new URL(request.url).searchParams
    const data = filterAudit(events, query)
    return HttpResponse.json({
      data: query.get('order') === 'newest' ? data.toReversed() : data,
      meta: { next_cursor: null },
    })
  }),
  http.get('/api/v1/audit-log/people', () =>
    HttpResponse.json({
      data: [
        ...new Map(
          events.flatMap((event) => (event.actor ? [[event.actor.id, event.actor]] : [])),
        ).values(),
      ].toSorted((a, b) => a.name.localeCompare(b.name)),
    }),
  ),
  http.get('/api/v1/audit-log/verify', () =>
    HttpResponse.json({
      data: ok
        ? { ok, broken_at: null, entries: events.length }
        : { ok, broken_at: 7, entries: events.length },
    }),
  ),
]

const page = (role: string, extra: ReturnType<typeof http.get>[] = []) => ({
  msw: {
    handlers: [
      http.get('/api/v1/session', () => HttpResponse.json(session(role))),
      ...periodHandlers,
      ...extra,
    ],
  },
})

const Shell = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>
    <SidebarInset>{children}</SidebarInset>
  </SidebarProvider>
)
// The page at phone width: its own layout must not scroll sideways.
const Phone = ({ children }: { children: ReactNode }) => (
  <div data-testid="phone" className="w-[390px] overflow-x-auto border border-dashed">
    <Shell>{children}</Shell>
  </div>
)
const fitsPhone = async (canvas: HTMLElement) => {
  const phone = within(canvas).getByTestId('phone').getBoundingClientRect()
  // The page content, not the header's actions (those move into one menu elsewhere).
  const parts = [...canvas.querySelectorAll('section, h1')]
  await expect(
    Math.max(...parts.map((part) => part.getBoundingClientRect().right)),
  ).toBeLessThanOrEqual(phone.right)
}

const meta = {
  title: 'Books/Settings',
  parameters: { layout: 'fullscreen', ownMain: true },
  beforeEach: () => {
    resetPeriods()
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

/**
 * Where the books stand and the one primary action on top; each year as a strip of its months and a
 * row per month with what was issued and booked in it, and a warning when drafts are dated in it.
 */
export const Periods: Story = {
  parameters: page('owner'),
  render: () => (
    <Shell>
      <PeriodsSettings />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const last = monthLabel(lastMonth)
    const open = monthLabel(threeMonthsAgo)
    await expect(await canvas.findByText(/latest closed month is/)).toHaveTextContent(last)
    await expect(canvas.getByText('Current month')).toBeVisible()
    const closedRow = canvas.getByRole('listitem', { name: last })
    await expect(within(closedRow).getByText('Closed')).toBeVisible()
    await expect(within(closedRow).getByText('Anna Muster')).toBeVisible()
    await expect(closedRow).toHaveTextContent(/· AMAnna Muster/)
    const row = canvas.getByRole('listitem', { name: open })
    await expect(within(row).getByText('Open')).toBeVisible()
    await expect(await within(row).findByText(/\d+ issued/)).toBeVisible()
    await userEvent.click(within(row).getByRole('button', { name: `Actions for ${open}` }))
    await userEvent.click(
      await body(canvasElement).findByRole('menuitem', { name: `Close ${open}` }),
    )
    await userEvent.click(await body(canvasElement).findByRole('button', { name: 'Close month' }))
    await waitFor(() => expect(body(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(
      await within(await canvas.findByRole('listitem', { name: open })).findByText('Closed'),
    ).toBeVisible()
  },
}

/** The owner's view at rest: the status band with its one primary action, and the months by year. */
export const PeriodsOverview: Story = {
  parameters: page('owner'),
  render: Periods.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('button', { name: /^Close through [A-Z][a-z]+ \d{4}$/ }),
    ).toBeEnabled()
    await expect(canvas.getAllByRole('button', { name: /^Actions for / }).length).toBeGreaterThan(1)
  },
}

export const PeriodsDark: Story = { ...Periods, parameters: { ...Periods.parameters, dark: true } }

/** A member sees each month's state and activity but no actions. */
export const PeriodsMember: Story = {
  parameters: page('member'),
  render: Periods.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('View only: ask an owner or admin for edit access.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^(Close|Actions for) / })).toBeNull()
  },
}

export const PeriodsPhone: Story = {
  parameters: page('owner'),
  render: () => (
    <Phone>
      <PeriodsSettings />
    </Phone>
  ),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(/months to close/)
    await fitsPhone(canvasElement)
  },
}

export const PeriodsPhoneDark: Story = {
  ...PeriodsPhone,
  parameters: { ...PeriodsPhone.parameters, dark: true },
}

/** Reopening asks why; the reason is required and goes into the audit log. */
export const PeriodsReopen: Story = {
  parameters: page('owner'),
  render: Periods.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const last = monthLabel(lastMonth)
    const row = await canvas.findByRole('listitem', { name: last })
    await userEvent.click(within(row).getByRole('button', { name: `Actions for ${last}` }))
    await userEvent.click(
      await body(canvasElement).findByRole('menuitem', { name: `Reopen ${last}…` }),
    )
    const dialog = within(
      await body(canvasElement).findByRole('dialog', { name: `Reopen ${last}?` }),
    )
    await expect(dialog.getByRole('button', { name: /Reopen month/ })).toBeDisabled()
    await userEvent.type(dialog.getByRole('textbox', { name: 'Reason' }), 'Late supplier invoice')
    await userEvent.click(dialog.getByRole('button', { name: /Reopen month/ }))
    await waitFor(() => expect(body(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(
      await within(await canvas.findByRole('listitem', { name: last })).findByText('Open'),
    ).toBeVisible()
  },
}

/** "Close through …" closes every open month that has ended, oldest first, after a confirmation. */
export const PeriodsCloseUpTo: Story = {
  parameters: page('owner'),
  render: Periods.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/have ended and are still open/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /^Close through [A-Z][a-z]+ \d{4}$/ }))
    const dialog = within(
      await body(canvasElement).findByRole('dialog', { name: /^Close \d+ months\?$/ }),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Close months' }))
    await waitFor(() => expect(body(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(await canvas.findByText('Every month that has ended is closed.')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Close through/ })).toBeNull()
  },
}

// Nothing closed yet: every month of the last year is open, the long list the picker groups.
const allOpen = endedMonths(today(), 12)
const yearsOf = (months: string[]) => [...new Set(months.map((month) => month.slice(0, 4)))]
const visibleHeadings = (picker: HTMLElement) =>
  [...picker.querySelectorAll('[cmdk-group]:not([hidden]) [cmdk-group-heading]')].map(
    (heading) => heading.textContent,
  )
const openPicker = async (canvasElement: HTMLElement) => {
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: 'Close through an earlier month' }),
  )
  return body(canvasElement).findByRole('dialog')
}

/** The split button's menu: every open month, grouped by year, newest first, with how many it closes. */
export const PeriodsPicker: Story = {
  parameters: page('owner'),
  beforeEach: () => {
    periods = []
  },
  render: Periods.render,
  play: async ({ canvasElement }) => {
    const picker = await openPicker(canvasElement)
    await expect(within(picker).getByPlaceholderText('Search months…')).toHaveFocus()
    await expect(visibleHeadings(picker)).toEqual(yearsOf(allOpen))
    const options = within(picker).getAllByRole('option')
    await expect(options).toHaveLength(12)
    await expect(options[0]).toHaveTextContent(/12 months$/)
    await expect(options.at(-1)).toHaveTextContent(/1 month$/)
  },
}

export const PeriodsPickerDark: Story = {
  ...PeriodsPicker,
  parameters: { ...PeriodsPicker.parameters, dark: true },
}

export const PeriodsPickerPhone: Story = {
  ...PeriodsPicker,
  render: PeriodsPhone.render,
  play: async (context) => {
    await PeriodsPicker.play?.(context)
    const picker = await body(context.canvasElement).findByRole('dialog')
    const box = picker.getBoundingClientRect()
    await expect(box.left).toBeGreaterThanOrEqual(0)
    await expect(box.width).toBeLessThanOrEqual(390)
  },
}

/** Search narrows by name, year or number; nothing found says so; picking a month asks to confirm. */
export const PeriodsPickerSearch: Story = {
  ...PeriodsPicker,
  play: async ({ canvasElement }) => {
    const picker = await openPicker(canvasElement)
    const search = within(picker).getByPlaceholderText('Search months…')
    const oldest = allOpen.at(-1) ?? ''
    const year = oldest.slice(0, 4)
    await userEvent.type(search, year)
    await expect(visibleHeadings(picker)).toEqual([year])
    await expect(within(picker).getAllByRole('option')).toHaveLength(
      allOpen.filter((month) => month.startsWith(year)).length,
    )
    await userEvent.clear(search)
    await userEvent.type(search, 'zzz')
    await expect(within(picker).getByText('No open month matches.')).toBeVisible()
    await userEvent.clear(search)
    await userEvent.type(search, String(Number(oldest.slice(5))))
    await userEvent.click(
      within(picker).getByRole('option', { name: new RegExp(`^${monthLabel(oldest)}`) }),
    )
    const dialog = within(
      await body(canvasElement).findByRole('dialog', { name: `Close ${monthLabel(oldest)}?` }),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Close month' }))
    await expect(await within(canvasElement).findByText('11 months to close')).toBeVisible()
  },
}

/** Newest first by day, one sentence per event; the portal switched off and on folds into one row. */
export const AuditLog: Story = {
  parameters: page('owner', auditHandlers(auditEvents)),
  render: () => (
    <Shell>
      <AuditLogSettings />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Chain verified · 19 entries intact')).toBeVisible()
    const todays = await canvas.findByRole('region', { name: 'Today' })
    await expect(within(todays).getByText('3 entries')).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Yesterday' })).toBeVisible()
    await expect(
      within(todays).getByRole('button', { name: 'Details of: Invoice 2026-036 voided' }),
    ).toBeVisible()
    // The record's number links to its drawer; no internal id or chain number is shown.
    await expect(within(todays).getAllByRole('link', { name: '2026-031' })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/\/invoices\/?\?id=inv_mock_1$/),
    )
    await expect(canvas.queryByText(/wsp_|#\d/)).toBeNull()
    const folded = canvas.getByRole('button', {
      name: 'Details of: Client portal turned off and on 6 times',
    })
    const row = folded.closest('li')
    if (!row) throw new Error('The folded row is not a list item.')
    await expect(row).toHaveTextContent(/08:47.09:14/)
    await expect(row).toHaveTextContent('Marco Bernasconi')
  },
}

/** A member with a photo shows it in the rows and the person filter; one without keeps their initials. */
export const AuditLogPhotos: Story = {
  parameters: AuditLog.parameters,
  render: AuditLog.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = body(canvasElement)
    await canvas.findByRole('region', { name: 'Today' })
    const marco = canvas.getAllByText('Marco Bernasconi')[0]!.parentElement!
    await waitFor(() =>
      expect(marco.querySelector('[data-slot="avatar-image"]')).toBeInTheDocument(),
    )
    await expect(marco).not.toHaveTextContent('MB')
    const withoutPhoto = canvas.getAllByText('Anna Muster')[0]!.parentElement!
    await expect(withoutPhoto.querySelector('[data-slot="avatar-image"]')).toBeNull()
    await expect(withoutPhoto).toHaveTextContent('AM')

    await userEvent.click(canvas.getByRole('button', { name: 'Person' }))
    const item = await screen.findByRole('menuitemradio', { name: /Marco Bernasconi/ })
    await waitFor(() =>
      expect(item.querySelector('[data-slot="avatar-image"]')).toBeInTheDocument(),
    )
    await expect(screen.getByRole('menuitemradio', { name: /Anna Muster/ })).toHaveTextContent('AM')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  },
}

/** A folded row opens to each of its entries. */
export const AuditLogFoldOpen: Story = {
  parameters: AuditLog.parameters,
  render: AuditLog.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Show each' }))
    await expect(
      canvas.getAllByRole('button', { name: 'Details of: Client portal turned off' }),
    ).toHaveLength(3)
    await expect(
      canvas.getAllByRole('button', { name: 'Details of: Client portal turned on' }),
    ).toHaveLength(3)
    await expect(canvas.getByRole('button', { name: 'Hide each' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

/** Type, person and search narrow the list; nothing matching says so and offers to clear. */
export const AuditLogFilters: Story = {
  parameters: AuditLog.parameters,
  render: AuditLog.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = body(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Type' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Payments' }))
    await expect(await canvas.findByText('2 entries shown')).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: /Details of: Refund of CHF 50.00/ }),
    ).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Payments' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'All types' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Person' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Marco Bernasconi/ }))
    await expect(await canvas.findByText('8 entries shown')).toBeVisible()

    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search the audit log' }), 'zzz')
    await expect(await canvas.findByText('No entries match')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search and filters' }))
    await expect(await canvas.findByText('19 entries')).toBeVisible()
  },
}

/** A row opens its details: who, when, the record, what was recorded and the chain's hashes. */
export const AuditLogDetails: Story = {
  parameters: AuditLog.parameters,
  render: AuditLog.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', {
        name: 'Details of: Client portal address changed to muster-ag',
      }),
    )
    const drawer = within(await body(canvasElement).findByRole('dialog'))
    await expect(drawer.getByText('Anna Muster')).toBeVisible()
    await expect(drawer.getByText('muster')).toBeVisible()
    await expect(drawer.getByText('Before')).toBeVisible()
    await userEvent.click(drawer.getByText('Technical details'))
    await expect(drawer.getByText('#9')).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Copy Hash' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Copy Previous hash' })).toBeVisible()
  },
}

/** While the first page loads: a quiet skeleton of rows. */
export const AuditLogLoading: Story = {
  parameters: page('owner', [
    http.get('/api/v1/audit-log', async () => {
      await delay('infinite')
      return HttpResponse.json({})
    }),
    ...auditHandlers(auditEvents).slice(1),
  ]),
  render: AuditLog.render,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('status', { name: 'Loading' }),
    ).toBeInTheDocument()
  },
}

export const AuditLogDark: Story = {
  ...AuditLog,
  parameters: { ...AuditLog.parameters, dark: true },
}

/** A broken chain is a clear red status line. */
export const AuditLogBroken: Story = {
  parameters: page('owner', auditHandlers(auditEvents.slice(0, 8), false)),
  render: AuditLog.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/Chain broken at entry #7/)).toBeVisible()
  },
}

/** Before anything is recorded: an explained empty state. */
export const AuditLogEmpty: Story = {
  parameters: page('owner', auditHandlers([])),
  render: AuditLog.render,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Nothing recorded yet')).toBeVisible()
    // No toolbar or filters while there is nothing to list.
    await expect(within(canvasElement).queryByRole('searchbox')).toBeNull()
  },
}

export const AuditLogPhone: Story = {
  parameters: page('owner', auditHandlers(auditEvents)),
  render: () => (
    <Phone>
      <AuditLogSettings />
    </Phone>
  ),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText('Chain verified · 19 entries intact')
    await fitsPhone(canvasElement)
  },
}

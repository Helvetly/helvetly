import { SidebarInset, SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AuditLogSettings } from '@/components/settings/audit-log'
import { endedMonths, monthLabel, PeriodsSettings } from '@/components/settings/periods-settings'
import type { FinancialEvent, Period } from '@/lib/books'
import { today } from '@/lib/invoices'
import { auditEvents, sampleActivity } from '@/mocks/data'

const session = (role: string) => ({
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role,
  scopes: ['*:*'],
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
  http.get('/api/v1/audit-log', () =>
    HttpResponse.json({ data: events, meta: { next_cursor: null } }),
  ),
  http.get('/api/v1/audit-log/verify', () =>
    HttpResponse.json({ data: ok ? { ok, broken_at: null } : { ok, broken_at: 7 } }),
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
    await expect(within(closedRow).getByText(/· Anna Muster$/)).toBeVisible()
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
    await expect(await canvas.findByText(/Only an owner or admin can close/)).toBeVisible()
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

/** Events as a timeline by day, each with its icon, reference, person and time. */
export const AuditLog: Story = {
  parameters: page('owner', auditHandlers(auditEvents)),
  render: () => (
    <Shell>
      <AuditLogSettings />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Chain verified')).toBeVisible()
    const first = await canvas.findByRole('listitem', { name: /^#1 Invoice issued/ })
    await expect(within(first).getByText('Anna Muster')).toBeVisible()
    await expect(within(first).getByText('2026-031')).toBeVisible()
    await expect(canvas.getByRole('listitem', { name: /^#4 / })).toHaveTextContent('System')
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
    await within(canvasElement).findByText('Chain verified')
    await fitsPhone(canvasElement)
  },
}

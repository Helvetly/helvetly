import { SidebarInset, SidebarProvider } from '@helvetly/ui/components/sidebar'
import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { Calendars } from '@/components/scheduling/settings/calendars'
import { SchedulingSettingsPage } from '@/components/scheduling/settings/scheduling-settings'
import {
  googleConnection,
  resetSchedulingSettings,
  sampleEventType,
  schedulingCalls,
  schedulingSettingsHandlers,
} from '@/mocks/scheduling-settings'

const session = (role: string) => ({
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role,
  scopes: role === 'member' ? ['read:*'] : ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
})

const page = (role: string) => ({
  msw: {
    handlers: [
      http.get('/api/v1/session', () => HttpResponse.json(session(role))),
      http.get('/api/v1/members', () =>
        HttpResponse.json({
          data: [
            {
              user_id: 'usr_story',
              name: 'Anna Muster',
              email: 'anna@example.com',
              role: 'owner',
              scopes: ['*:*'],
              joined_at: '2026-01-05T09:00:00Z',
              last_active_at: null,
              is_you: true,
            },
          ],
        }),
      ),
      ...schedulingSettingsHandlers,
    ],
  },
})

const Shell = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>
    <SidebarInset>{children}</SidebarInset>
  </SidebarProvider>
)

// The colours Google gives these calendars; one without a colour gets the neutral dot.
const PROVIDER_COLOURS: Record<string, string> = {
  primary: '#4285f4',
  team: '#33b679',
  holidays: '#f6bf26',
}
const colouredGoogle = {
  ...googleConnection,
  calendars: googleConnection.calendars.map((calendar) => ({
    ...calendar,
    color: PROVIDER_COLOURS[calendar.id] ?? null,
  })),
}

const meta = {
  title: 'Scheduling/Settings',
  parameters: {
    layout: 'fullscreen',
    ownMain: true,
    nextjs: { navigation: { pathname: '/settings/scheduling/' } },
  },
  beforeEach: () => resetSchedulingSettings(),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

/** Owners and admins edit; the example sentence under the policy follows what they type. */
export const PolicyExample: Story = {
  parameters: page('owner'),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Once under the notice field, once in the example.
    await expect(
      await canvas.findAllByText(/Clients can cancel free of charge up to/),
    ).toHaveLength(2)
    await expect(canvas.getByText(/A later cancellation counts as used\./)).toBeVisible()
    await userEvent.click(canvas.getByRole('switch', { name: 'Late cancellations count as used' }))
    await expect(canvas.getByText(/A later cancellation is still free\./)).toBeVisible()
  },
}

/** The notice is a preset in words, or Custom… with its unit beside it; the sentence under it follows. */
export const NoticePresets: Story = {
  parameters: page('owner'),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const notice = await canvas.findByRole('button', { name: /^Free cancellation until/ })
    await expect(notice).toHaveTextContent('24 hours before')
    await expect(
      canvas.getByText(
        'Clients can cancel free of charge up to 24 hours before the session. Later cancellations count as late.',
      ),
    ).toBeVisible()

    await userEvent.click(notice)
    await userEvent.click(
      await body(canvasElement).findByRole('option', { name: '48 hours before' }),
    )
    await expect(canvas.getByText(/up to 48 hours before the session\./)).toBeVisible()

    await userEvent.click(notice)
    await userEvent.click(await body(canvasElement).findByRole('option', { name: 'Custom…' }))
    const amount = canvas.getByRole('textbox', { name: 'Custom amount' })
    await expect(amount).toHaveValue('2')
    await expect(canvas.getByRole('combobox', { name: 'Unit' })).toHaveValue('days')
    await userEvent.clear(amount)
    await userEvent.type(amount, '36')
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Unit' }), 'hours')
    await expect(canvas.getByText(/up to 36 hours before the session\./)).toBeVisible()

    const policy = within(
      canvasElement.querySelector<HTMLElement>('#scheduling-policy') ?? canvasElement,
    )
    await userEvent.click(policy.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(schedulingCalls()).toContain('PUT /scheduling/settings'))
    await expect(
      await canvas.findByRole('button', { name: /^Free cancellation until/ }),
    ).toHaveTextContent('Custom…')
  },
}

/** Everyone else reads the workspace's settings but cannot change them; their own calendars, feed and hours come first and stay theirs to edit. */
export const ReadOnlyForMembers: Story = {
  parameters: page('member'),
  beforeEach: () => resetSchedulingSettings({ providers: ['google'] }),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/only owners and admins change them/)).toBeVisible()
    await expect(
      canvas.getByRole('switch', { name: 'Late cancellations count as used' }),
    ).toBeDisabled()
    const regions = canvas.getAllByRole('region')
    await expect(regions[0]).toHaveAccessibleName('Your calendars')
    await expect(await canvas.findByRole('link', { name: 'Connect' })).toHaveAttribute(
      'href',
      '/api/v1/scheduling/calendars/google/connect',
    )
    await userEvent.click(await canvas.findByRole('button', { name: 'Create feed' }))
    await expect(await canvas.findByRole('textbox', { name: 'Feed address' })).toBeVisible()
  },
}

/** The provider's redirect lands here (`?calendar=connected`): a toast says so and the address is cleaned. */
export const CalendarConnectedToast: Story = {
  parameters: page('owner'),
  beforeEach: () => {
    resetSchedulingSettings({ providers: ['google'], connections: [googleConnection] })
    const url = new URL(window.location.href)
    url.searchParams.set('calendar', 'connected')
    window.history.replaceState(null, '', url)
  },
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
      <Toaster />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText('Calendar connected.')).toBeInTheDocument()
    await expect(new URLSearchParams(window.location.search).get('calendar')).toBeNull()
  },
}

/** The holiday suggestion adds the canton's days to the list. */
export const HolidaySuggestion: Story = {
  parameters: page('owner'),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Suggest \d{4} holidays/ }))
    await expect(await canvas.findByText('Swiss National Day')).toBeVisible()
  },
}

const holidaysOf = async (canvasElement: HTMLElement) =>
  within(await within(canvasElement).findByRole('region', { name: 'Holidays and days off' }))

/** No days off: one quiet line inside the card, the canton select and suggestion above it. */
export const HolidaysEmpty: Story = {
  parameters: page('owner'),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const holidays = await holidaysOf(canvasElement)
    await expect(await holidays.findByText(/^No days off yet\./)).toBeVisible()
    await expect(holidays.getByRole('button', { name: /Public holidays/ })).toBeVisible()
    await expect(holidays.getByRole('button', { name: /^Suggest \d{4} holidays$/ })).toBeVisible()
  },
}

/** Saved days grouped by year; suggested ones carry a "Public holiday" badge. */
export const HolidaysWithDays: Story = {
  parameters: page('owner'),
  beforeEach: () =>
    resetSchedulingSettings({
      holidays: [
        { date: '2025-12-31', name: 'Year-end closing' },
        { date: '2026-12-24', name: 'Company outing' },
      ],
    }),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const holidays = await holidaysOf(canvasElement)
    await expect(await holidays.findByText('Company outing')).toBeVisible()
    await expect(holidays.getByRole('region', { name: '2025' })).toBeVisible()
    await expect(holidays.queryByText('Public holiday')).toBeNull()
    await userEvent.click(holidays.getByRole('button', { name: /^Suggest \d{4} holidays$/ }))
    await expect(await holidays.findByText('Swiss National Day')).toBeVisible()
    await expect(holidays.getAllByText('Public holiday')).toHaveLength(3)
  },
}

/** "Add day off" opens an inline row: Escape cancels, Enter adds, Save stores the list. */
export const HolidayAdd: Story = {
  parameters: page('owner'),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const holidays = await holidaysOf(canvasElement)
    await userEvent.click(await holidays.findByRole('button', { name: 'Add day off' }))
    await userEvent.keyboard('{Escape}')
    await expect(holidays.queryByRole('textbox', { name: 'Name' })).toBeNull()
    await userEvent.click(holidays.getByRole('button', { name: 'Add day off' }))
    const name = holidays.getByRole('textbox', { name: 'Name' })
    await userEvent.type(name, 'Company outing{Enter}')
    await expect(await holidays.findByRole('alert')).toHaveTextContent('Pick a date.')
    await userEvent.type(holidays.getByLabelText('Date'), '2027-06-18')
    await userEvent.click(name)
    await userEvent.keyboard('{Enter}')
    await expect(await holidays.findByText('Company outing')).toBeVisible()
    await expect(holidays.queryByRole('textbox', { name: 'Name' })).toBeNull()
    await userEvent.click(holidays.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(schedulingCalls()).toContain('PUT /scheduling/holidays'))
  },
}

/** Each day's remove button takes it off the list until the section is saved. */
export const HolidayRemove: Story = {
  parameters: page('owner'),
  beforeEach: () =>
    resetSchedulingSettings({ holidays: [{ date: '2026-12-24', name: 'Company outing' }] }),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const holidays = await holidaysOf(canvasElement)
    await userEvent.click(await holidays.findByRole('button', { name: 'Remove Company outing' }))
    await expect(await holidays.findByText(/^No days off yet\./)).toBeVisible()
    await userEvent.click(holidays.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(schedulingCalls()).toContain('PUT /scheduling/holidays'))
  },
}

/** An event type is made in a drawer and listed afterwards. */
export const EventTypeDrawer: Story = {
  parameters: page('owner'),
  beforeEach: () => resetSchedulingSettings({ eventTypes: [sampleEventType] }),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Intro call')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'New event type' }))
    const drawer = body(canvasElement)
    await userEvent.click(await drawer.findByRole('button', { name: 'Save event type' }))
    await expect(await drawer.findByText('Enter a name.')).toBeVisible()
    await userEvent.type(drawer.getByRole('textbox', { name: 'Name' }), 'Follow-up')
    await userEvent.click(drawer.getByRole('button', { name: 'Save event type' }))
    await waitFor(() => expect(canvas.getByText('Follow-up')).toBeVisible())
  },
}

/** Your calendars: the connected one as a card (status, Sync now, ⋯ with Disconnect); the rest as rows to connect. */
export const YourCalendars: Story = {
  parameters: page('owner'),
  beforeEach: () =>
    resetSchedulingSettings({
      providers: ['google', 'microsoft'],
      connections: [colouredGoogle],
    }),
  render: () => (
    <Shell>
      <Calendars userId="usr_story" />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect((await canvas.findAllByText('anna@muster.ch'))[0]).toBeVisible()
    await expect(canvas.getByText('Synced 2 minutes ago')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Connect' })).toHaveAttribute(
      'href',
      '/api/v1/scheduling/calendars/microsoft/connect',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Sync now' }))
    await waitFor(() =>
      expect(schedulingCalls()).toContain('POST /scheduling/calendars/cal_google/sync'),
    )
    // Long calendar names are cut, each calendar shows its own colour.
    await expect(
      canvasElement.querySelectorAll('[data-slot="calendar-dot"]').length,
    ).toBeGreaterThan(3)
    await expect(canvas.getByText('Primary')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'More for Google Calendar' }))
    await userEvent.click(await body(canvasElement).findByRole('menuitem', { name: 'Disconnect' }))
    await userEvent.click(
      await body(canvasElement).findByRole('button', { name: 'Disconnect, keep the events' }),
    )
    await waitFor(() =>
      expect(schedulingCalls()).toContain(
        'DELETE /scheduling/calendars/cal_google?keep_events=true',
      ),
    )
  },
}

/** Only Google is configured here, so Outlook has no button. */
export const ConnectOffersConfiguredProviders: Story = {
  parameters: page('owner'),
  beforeEach: () => resetSchedulingSettings({ providers: ['microsoft'] }),
  render: () => (
    <Shell>
      <Calendars userId="usr_story" />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: 'Connect' })).toHaveAttribute(
      'href',
      '/api/v1/scheduling/calendars/microsoft/connect',
    )
    await expect(canvas.queryByText('Google Calendar')).toBeNull()
    // The provider's own logo, not a generic calendar icon.
    await expect(
      canvasElement.querySelector('[data-slot="row-icon"] svg[data-mark="microsoft"]'),
    ).not.toBeNull()
  },
}

/** On Free, sessions and the iCal feed work, but Google and Microsoft calendars come with a paid plan. */
export const CalendarSyncNotOnFree: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', () => HttpResponse.json({ data: billingFixture() })),
        ...page('owner').msw.handlers,
      ],
    },
  },
  beforeEach: () => resetSchedulingSettings({ providers: ['google'] }),
  render: () => (
    <Shell>
      <Calendars userId="usr_story" />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(/Google and Microsoft calendar sync comes with the Basic plan/),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/settings/billing/plans/',
    )
    await expect(canvas.getByRole('button', { name: 'Connect' })).toBeDisabled()
    await expect(canvas.queryByRole('link', { name: 'Connect' })).toBeNull()
  },
}

/** The iCal feed: create, then rotate behind a confirmation. */
export const CalendarFeed: Story = {
  parameters: page('owner'),
  beforeEach: () => resetSchedulingSettings({ providers: [] }),
  render: () => (
    <Shell>
      <Calendars userId="usr_story" />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Create feed' }))
    await expect(await canvas.findByRole('textbox', { name: 'Feed address' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Rotate address' }))
    await userEvent.click(
      await body(canvasElement).findByRole('button', { name: 'Rotate address' }),
    )
    await waitFor(() =>
      expect(schedulingCalls().filter((c) => c === 'POST /scheduling/feed')).toHaveLength(2),
    )
  },
}

/** A member who never chose a zone follows the workspace's; the page must not break on it. */
export const HoursFollowWorkspaceZone: Story = {
  parameters: page('owner'),
  beforeEach: () => resetSchedulingSettings({ providers: [], hours: { time_zone: null } }),
  render: () => (
    <Shell>
      <Calendars userId="usr_story" />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const zone = await canvas.findByRole('button', { name: 'Time zone' })
    await waitFor(() => expect(zone).toHaveTextContent('Zurich'))
  },
}

/** A connection that needs attention says so in red; a revoked one offers Reconnect instead of Sync now. */
export const CalendarNeedsAttention: Story = {
  parameters: page('owner'),
  beforeEach: () =>
    resetSchedulingSettings({
      providers: ['google', 'microsoft'],
      connections: [
        { ...googleConnection, status: 'revoked' },
        {
          ...googleConnection,
          id: 'cal_microsoft',
          provider: 'microsoft',
          account_email: 'anna@muster.onmicrosoft.com',
          status: 'error',
          error: 'Microsoft did not answer.',
        },
      ],
    }),
  render: () => (
    <Shell>
      <Calendars userId="usr_story" />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/api/v1/scheduling/calendars/google/connect',
    )
    await expect(
      canvas
        .getAllByRole('alert')
        .some((one) => /Microsoft did not answer/.test(one.textContent ?? '')),
    ).toBe(true)
    // Settings are hidden until the connection works again.
    await expect(canvas.queryByText('Check these calendars for conflicts')).toBeNull()
  },
}

/** Someone who never saved hours gets Monday to Friday, 09:00–17:00 to save or change. */
export const WeeklyHoursSuggested: Story = {
  parameters: page('owner'),
  beforeEach: () =>
    resetSchedulingSettings({
      providers: [],
      hours: { saved: false, bookable: true, time_zone: null, weekly: [], overrides: [] },
    }),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByLabelText('From, Monday')).toHaveValue('09:00')
    await expect(canvas.getByLabelText('To, Friday')).toHaveValue('17:00')
    await expect(canvas.getByRole('switch', { name: 'Saturday' })).not.toBeChecked()
    const workspace = canvas.getByRole('button', { name: 'Workspace' })
    await userEvent.click(workspace)
    await expect(getRouter().push).toHaveBeenCalledWith('/settings/workspace')
    await expect(body(canvasElement).queryByRole('dialog')).not.toBeInTheDocument()
    await expect(canvas.queryByText('Unsaved changes')).not.toBeInTheDocument()

    getRouter().push.mockClear()
    await userEvent.click(canvas.getByRole('switch', { name: 'I can be booked' }))
    await userEvent.click(workspace)
    const dialog = await body(canvasElement).findByRole('dialog', { name: 'Leave without saving?' })
    await expect(getRouter().push).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stay' }))

    const hours = within(canvas.getByRole('region', { name: 'Weekly hours' }))
    await userEvent.click(hours.getByRole('button', { name: 'Discard' }))
    await expect(hours.getByLabelText('From, Monday')).toHaveValue('09:00')
    await expect(hours.getByRole('switch', { name: 'I can be booked' })).toBeChecked()
    await userEvent.click(hours.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(schedulingCalls()).toContain('PUT /scheduling/hosts/usr_story'))
  },
}

export const LeaveWithSavedHours: Story = {
  parameters: page('owner'),
  beforeEach: () =>
    resetSchedulingSettings({ providers: ['google'], connections: [colouredGoogle] }),
  render: () => (
    <Shell>
      <SchedulingSettingsPage />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(colouredGoogle.account_email)).toBeVisible()
    await expect(await canvas.findByLabelText('To, Tuesday')).toHaveValue('17:00')
    await userEvent.click(canvas.getByRole('button', { name: 'Workspace' }))
    await expect(getRouter().push).toHaveBeenCalledWith('/settings/workspace')
    await expect(body(canvasElement).queryByRole('dialog')).not.toBeInTheDocument()
  },
}

/** One list for the week: switch a day on, add a range, copy a day to the others, save. */
export const WeeklyHoursEditing: Story = {
  parameters: page('owner'),
  beforeEach: () => resetSchedulingSettings({ providers: [] }),
  render: () => (
    <Shell>
      <Calendars userId="usr_story" />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('switch', { name: 'Wednesday' }))
    await expect(canvas.getByLabelText('From, Wednesday')).toHaveValue('09:00')
    await userEvent.click(canvas.getByRole('button', { name: 'Add a time range on Wednesday' }))
    await expect(canvas.getAllByLabelText('From, Wednesday')[1]).toHaveValue('18:00')
    await userEvent.click(
      canvas.getByRole('button', { name: /^Copy Monday.s hours to other days$/ }),
    )
    await userEvent.click(await body(canvasElement).findByRole('menuitem', { name: 'Every day' }))
    const starts = (day: string) =>
      canvas.getAllByLabelText(`From, ${day}`).map((one) => (one as HTMLSelectElement).value)
    await expect(['Tuesday', 'Wednesday', 'Sunday'].map(starts)).toEqual([
      ['09:00', '13:00'],
      ['09:00', '13:00'],
      ['09:00', '13:00'],
    ])
    await userEvent.click(canvas.getByRole('switch', { name: 'Sunday' }))
    await expect(canvas.queryByLabelText('From, Sunday')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(schedulingCalls()).toContain('PUT /scheduling/hosts/usr_story'))
    await waitFor(() => expect(canvas.queryByText('Unsaved changes')).not.toBeInTheDocument())
    await expect(canvas.getAllByLabelText('To, Saturday')[1]).toHaveValue('17:00')
  },
}

/** An end before its start or overlapping ranges are marked at once, worded under the list, and refused on save. */
export const WeeklyHoursValidation: Story = {
  parameters: page('owner'),
  beforeEach: () => resetSchedulingSettings({ providers: [] }),
  render: () => (
    <Shell>
      <Calendars userId="usr_story" />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const end = await canvas.findByLabelText('To, Tuesday')
    const listBox = canvas.getByRole('list', { name: 'Weekly hours' })
    const height = listBox.getBoundingClientRect().height
    await userEvent.selectOptions(end, '08:00')
    await expect(end).toHaveAttribute('aria-invalid', 'true')
    await expect(canvas.getByText('Tuesday: The end must be after the start.')).toBeVisible()
    // The message has its room already: nothing moves.
    await expect(listBox.getBoundingClientRect().height).toBe(height)
    await userEvent.selectOptions(end, '17:00')
    const [, afternoon] = canvas.getAllByLabelText('From, Monday')
    if (!afternoon) throw new Error('Monday has two ranges in the sample')
    await userEvent.selectOptions(afternoon, '11:00')
    await expect(canvas.getByText('Monday: Time ranges on one day can’t overlap.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(schedulingCalls()).not.toContain('PUT /scheduling/hosts/usr_story')
  },
}

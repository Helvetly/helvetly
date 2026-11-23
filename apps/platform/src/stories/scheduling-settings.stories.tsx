import { SidebarInset, SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Calendars } from '@/components/account/calendars'
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

const meta = {
  title: 'Scheduling/Settings',
  parameters: { layout: 'fullscreen', ownMain: true },
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

/** Everyone else reads the settings but cannot change them. */
export const ReadOnlyForMembers: Story = {
  parameters: page('member'),
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

/** Account page: only configured providers offer a button; a connection can be synced and disconnected. */
export const AccountCalendars: Story = {
  parameters: page('owner'),
  beforeEach: () =>
    resetSchedulingSettings({ providers: ['google'], connections: [googleConnection] }),
  render: () => (
    <Shell>
      <Calendars userId="usr_story" />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect((await canvas.findAllByText('anna@muster.ch'))[0]).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Sync now' }))
    await waitFor(() =>
      expect(schedulingCalls()).toContain('POST /scheduling/calendars/cal_google/sync'),
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Disconnect' }))
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

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { useState } from 'react'
import { Toaster } from 'sonner'
import { expect, fireEvent, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { SeriesDialog } from '@/components/scheduling/bits'
import { SessionDrawer, type DrawerTarget } from '@/components/scheduling/session-drawer'
import { SessionsPanel } from '@/components/scheduling/sessions-panel'
import { TodayCard } from '@/components/scheduling/today-card'
import { emptyState, sampleState, schedulingHandlers, STORY_NOW, TEAM } from '@/mocks/scheduling'

const ZONE = 'Europe/Zurich'
const state = sampleState()
const ALPENGLOW = { id: 'cli_01', name: 'Alpenglow Studio GmbH' }
const team = http.get('/api/v1/members', () => HttpResponse.json({ data: TEAM }))
const clients = http.get('/api/v1/clients', () =>
  HttpResponse.json({
    data: [
      { id: 'cli_01', number: 1, name: 'Alpenglow Studio GmbH', city: 'Zürich', currency: 'CHF' },
    ],
    meta: { page: 1, page_size: 8, total: 1, total_pages: 1 },
  }),
)

function Drawer({ start }: { start: DrawerTarget }) {
  const [target, setTarget] = useState<DrawerTarget | null>(start)
  return (
    <>
      {target && (
        <SessionDrawer
          target={target}
          zone={ZONE}
          now={STORY_NOW}
          onClose={() => setTarget(null)}
          onView={(id) => setTarget({ kind: 'view', id })}
        />
      )}
      <Toaster />
    </>
  )
}

const create = (
  start: Partial<Extract<DrawerTarget, { kind: 'create' }>['start']> = {},
): DrawerTarget => ({
  kind: 'create',
  start: {
    date: '2026-12-03',
    minutes: 14 * 60,
    hostId: 'usr_story',
    client: ALPENGLOW,
    location: 'Office',
    ...start,
  },
})

const meta = {
  title: 'Scheduling/Session drawer',
  parameters: { msw: { handlers: [team, clients, ...schedulingHandlers(state)] } },
  // Every story starts from the same sessions, whatever the last one wrote.
  beforeEach: () => {
    Object.assign(state, sampleState())
  },
  render: () => <Drawer start={create()} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const drawer = async () => within(await screen.findByRole('dialog'))
/** A field of the session form by its id: date and time inputs have no text role. */
const field = (name: string) => {
  const element = document.getElementById(`session-${name}`)
  if (!element) throw new Error(`No field ${name}`)
  return element
}
const toastShows = (text: string) => waitFor(() => expect(screen.getByText(text)).toBeVisible())
const titleField = async () =>
  within(await screen.findByRole('dialog', { name: 'New session' })).getByRole('textbox', {
    name: /^Title/,
  })

/** A one-off session: title, then Schedule; the drawer turns into the new session's details. */
export const CreateOneOff: Story = {
  play: async () => {
    const sheet = await drawer()
    await expect(sheet.getByRole('heading', { name: 'New session' })).toBeVisible()
    // Without a running engagement the engagement picker is off, not empty.
    await expect(sheet.getByRole('button', { name: /^Engagement/ })).toBeDisabled()
    await userEvent.type(await titleField(), 'Kick-off')
    await userEvent.click(sheet.getByRole('button', { name: 'Schedule' }))
    await toastShows('Session scheduled.')
    await expect(await sheet.findByRole('heading', { name: 'Kick-off' })).toBeVisible()
  },
}

export const CreateOneOffDark: Story = { ...CreateOneOff, parameters: { dark: true } }

/** Weekly on Tuesdays and Thursdays, every 2 weeks, until a date: the summary reads it back with the count. */
export const RecurringSummary: Story = {
  render: () => <Drawer start={create({ date: '2026-12-01' })} />,
  play: async () => {
    const sheet = await drawer()
    await userEvent.click(sheet.getByRole('radio', { name: 'Weekly' }))
    await userEvent.click(sheet.getByRole('button', { name: 'Thursday' }))
    await userEvent.click(sheet.getByRole('button', { name: /^Every/ }))
    await userEvent.click(await screen.findByRole('option', { name: '2 weeks' }))
    await userEvent.click(sheet.getByRole('radio', { name: 'On a date' }))
    fireEvent.change(field('until'), { target: { value: '2027-06-30' } })
    await expect(
      await sheet.findByText('Every 2 weeks on Tue and Thu until 30 Jun 2027, 31 sessions'),
    ).toBeVisible()
  },
}

/** The slot overlaps another session and a busy time: one line under the time, the fields below stay put. */
export const ConflictsWarning: Story = {
  render: () => <Drawer start={create({ date: '2026-12-02', minutes: 9 * 60 + 30 })} />,
  play: async () => {
    const sheet = await drawer()
    const repeat = sheet.getByRole('radio', { name: 'Once' })
    const before = repeat.getBoundingClientRect().top
    await expect(await sheet.findByText(/1 overlap: /)).toBeVisible()
    await expect(sheet.getByText(/Strategy session/)).toBeVisible()
    await expect(repeat.getBoundingClientRect().top).toBe(before)
    // Moving the time onto the busy block names it without a title.
    fireEvent.change(field('time'), { target: { value: '14:00' } })
    await expect(await sheet.findByText(/busy in the host’s calendar/)).toBeVisible()
    await expect(repeat.getBoundingClientRect().top).toBe(before)
  },
}

/** Online: Google Meet works (my Google calendar is connected), Teams says why it does not. */
export const MeetingProviderDisabled: Story = {
  play: async () => {
    const sheet = await drawer()
    await userEvent.click(sheet.getByRole('radio', { name: 'Online' }))
    const teams = sheet.getByRole('button', { name: 'Microsoft Teams' })
    await expect(teams).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(teams)
    await expect(
      await screen.findByRole('tooltip', { name: /Connect your Microsoft 365 calendar/ }),
    ).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Google Meet' }))
    await expect(sheet.getByRole('button', { name: 'Google Meet' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(
      sheet.getByText('The link is made in the host’s calendar when you save.'),
    ).toBeVisible()
  },
}

/** Saving with nothing filled in names each missing field and focuses the first. */
export const Validation: Story = {
  render: () => <Drawer start={create({ client: null })} />,
  play: async () => {
    const sheet = await drawer()
    await userEvent.click(sheet.getByRole('button', { name: 'Schedule' }))
    await expect(await sheet.findByText('Choose a client.')).toBeVisible()
    await expect(sheet.getByText('Enter a title.')).toBeVisible()
    await waitFor(() => expect(sheet.getByRole('button', { name: /^Client/ })).toHaveFocus())
    // The client comes from a search.
    await userEvent.click(sheet.getByRole('button', { name: /^Client/ }))
    await userEvent.click(await screen.findByRole('option', { name: /Alpenglow Studio GmbH/ }))
    await waitFor(() => expect(sheet.queryByText('Choose a client.')).not.toBeInTheDocument())
  },
}

/** While the API answers, Schedule says so and cannot be pressed twice. */
export const PendingWrite: Story = {
  parameters: {
    msw: {
      handlers: [
        team,
        http.post('/api/v1/scheduling/events', async () => {
          await delay('infinite')
          return HttpResponse.json({})
        }),
        ...schedulingHandlers(state),
      ],
    },
  },
  play: async () => {
    const sheet = await drawer()
    await userEvent.type(await titleField(), 'Kick-off')
    await userEvent.click(sheet.getByRole('button', { name: 'Schedule' }))
    await expect(await sheet.findByRole('button', { name: 'Saving…' })).toBeDisabled()
  },
}

/** A series session: editing the time asks which sessions take it. */
export const EditSeriesSession: Story = {
  render: () => <Drawer start={{ kind: 'view', id: 'soc_series_2' }} />,
  play: async () => {
    const sheet = await drawer()
    await expect(await sheet.findByText(/Every week on Tue and Fri, 12 sessions/)).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Edit session' }))
    await sheet.findByRole('heading', { name: 'Edit session' })
    fireEvent.change(field('time'), { target: { value: '10:00' } })
    await userEvent.click(sheet.getByRole('button', { name: 'Save changes' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Change a recurring session' }))
    await userEvent.click(dialog.getByRole('radio', { name: /All sessions/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await toastShows('Saved. 1 changed session kept its own time.')
  },
}

/** The series dialog alone: the three scopes, each with what it does; a rule change leaves out "This session". */
const chosen = fn()
export const SeriesScopes: Story = {
  render: () => <SeriesDialog onChoose={chosen} onCancel={() => undefined} />,
  play: async () => {
    const dialog = within(await screen.findByRole('dialog'))
    await expect(dialog.getByRole('radio', { name: /This session/ })).toBeChecked()
    await expect(dialog.getByText(/sessions changed on their own keep their time/)).toBeVisible()
    await userEvent.click(dialog.getByRole('radio', { name: /This and following/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await expect(chosen).toHaveBeenCalledWith('following')
  },
}

export const SeriesScopesRuleChange: Story = {
  render: () => <SeriesDialog onlySeries onChoose={() => undefined} onCancel={() => undefined} />,
  play: async () => {
    const dialog = within(await screen.findByRole('dialog'))
    await expect(dialog.queryByRole('radio', { name: /This session/ })).not.toBeInTheDocument()
    await expect(dialog.getByRole('radio', { name: /This and following/ })).toBeChecked()
  },
}

/** An engagement's sessions: the next one and the ones held, with "Schedule session" prefilled. */
export const EngagementSessions: Story = {
  render: () => (
    <div className="max-w-xl">
      <SessionsPanel
        client={{ id: 'cli_02', name: 'Keller Holzbau AG' }}
        engagement={{ id: 'eng_1', title: 'Coaching package' }}
        now={STORY_NOW}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement)
    await expect(await panel.findByText('Upcoming')).toBeVisible()
    await expect(await panel.findByText('Held or counted')).toBeVisible()
    await userEvent.click(panel.getByRole('button', { name: 'Schedule session' }))
    const sheet = await drawer()
    await expect(sheet.getByText('Keller Holzbau AG')).toBeVisible()
    await expect(sheet.getByRole('textbox', { name: /^Title/ })).toHaveValue('Coaching package')
  },
}

/** A client without sessions: the client detail leaves the panel out. */
export const ClientWithoutSessions: Story = {
  parameters: { msw: { handlers: [team, ...schedulingHandlers(emptyState())] } },
  render: () => (
    <div className="max-w-xl" data-testid="panel">
      <SessionsPanel client={{ id: 'cli_09', name: 'Nobody AG' }} hideEmpty now={STORY_NOW} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 200))
    await expect(within(canvasElement).queryByText('Sessions')).not.toBeInTheDocument()
  },
}

/** The dashboard's Today card: my sessions still to come today and the requests waiting. */
export const Today: Story = {
  render: () => (
    <div className="max-w-md">
      <TodayCard now={STORY_NOW} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(await card.findByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(await card.findByRole('link', { name: '2 requests waiting' })).toBeVisible()
    await expect(card.getByRole('link', { name: /Strategy session/ }).getAttribute('href')).toMatch(
      /^\/scheduling\/?\?view=day&session=soc_1$/,
    )
  },
}

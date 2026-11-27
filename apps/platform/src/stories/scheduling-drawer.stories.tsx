import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { useState } from 'react'
import { Toaster } from 'sonner'
import { expect, fireEvent, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { RecordDrawersContext } from '@/components/record-link'
import { SeriesDialog } from '@/components/scheduling/bits'
import { SessionDrawer, type DrawerTarget } from '@/components/scheduling/session-drawer'
import { SessionsPanel } from '@/components/scheduling/sessions-panel'
import { TodayCard } from '@/components/scheduling/today-card'
import type { MoveItem, MovePreview } from '@/lib/scheduling'
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

/** The session form reads the client for its participants; the stories' clients have none unless one says so. */
const plainClient = http.get<{ id: string }>('/api/v1/clients/:id', ({ params }) =>
  HttpResponse.json({
    data: { id: params.id, name: 'Alpenglow Studio GmbH', is_company: false, contacts: [] },
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
  parameters: { msw: { handlers: [team, clients, ...schedulingHandlers(state), plainClient] } },
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

/** A Combobox trigger by its label: its name is the label followed by the chosen value. */
const picker = (sheet: ReturnType<typeof within>, label: string) =>
  sheet.getByRole('button', { name: new RegExp(`^${label}`) })
const pick = async (sheet: ReturnType<typeof within>, label: string, option: string) => {
  // Event types and hosts load first: their rows appear then.
  await userEvent.click(await sheet.findByRole('button', { name: new RegExp(`^${label}`) }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

/** A one-off session: title, then Schedule; the drawer turns into the new session's details. */
export const CreateOneOff: Story = {
  play: async () => {
    const sheet = await drawer()
    await expect(sheet.getByRole('heading', { name: 'New session' })).toBeVisible()
    // Without a running engagement and with one member hosting there is nothing to choose: both stay out.
    await expect(sheet.queryByRole('button', { name: /^Engagement/ })).not.toBeInTheDocument()
    await expect(sheet.getByRole('button', { name: /^Repeat Does not repeat/ })).toBeVisible()
    await expect(sheet.getByText(/3 Dec · 14:00 – 15:00 \(Zurich\)/)).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: '45 min' }))
    await expect(await sheet.findByText(/14:00 – 14:45/)).toBeVisible()
    await userEvent.type(await titleField(), 'Kick-off')
    await userEvent.click(sheet.getByRole('button', { name: 'Schedule' }))
    await toastShows('Session scheduled.')
    await expect(await sheet.findByRole('heading', { name: 'Kick-off' })).toBeVisible()
  },
}

export const CreateOneOffDark: Story = { ...CreateOneOff, parameters: { dark: true } }

/** An event type names the session (until a title is typed) and sets its length and place. */
export const EventTypePrefills: Story = {
  play: async () => {
    const sheet = await drawer()
    await pick(sheet, 'Event type', 'Intro call')
    await expect(await titleField()).toHaveValue('Intro call')
    await expect(sheet.getByRole('button', { name: 'My own link' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // A typed title stays when the type changes.
    await userEvent.clear(await titleField())
    await userEvent.type(await titleField(), 'First meeting')
    await pick(sheet, 'Event type', 'Coaching session')
    await expect(await titleField()).toHaveValue('First meeting')
  },
}

/** The event type's length is not asked again: the summary names it, and Change opens the picks anyway. */
export const EventTypeDuration: Story = {
  play: async () => {
    const sheet = await drawer()
    await expect(sheet.getByRole('button', { name: '45 min' })).toBeVisible()
    await pick(sheet, 'Event type', 'Intro call')
    await expect(await sheet.findByText(/3 Dec · 14:00 – 14:30 \(Zurich\)/)).toBeVisible()
    await expect(sheet.getByText('· 30 min')).toBeVisible()
    await expect(sheet.queryByRole('button', { name: '45 min' })).not.toBeInTheDocument()
    await userEvent.click(sheet.getByRole('button', { name: 'Change duration' }))
    await expect(sheet.getByRole('button', { name: '30 min' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(sheet.queryByRole('button', { name: 'Change duration' })).not.toBeInTheDocument()
    // The custom length's unit sits inside its field.
    await userEvent.click(sheet.getByRole('button', { name: 'Custom' }))
    const minutes = await sheet.findByRole('textbox', { name: 'Duration in minutes' })
    await expect(minutes.closest('[data-slot=input-group]')).toHaveTextContent('min')
  },
}

/** "Weekly on Thursday" from the repeat menu: the rule's panel and its summary, then a series is made. */
export const WeeklyViaSelect: Story = {
  play: async () => {
    const sheet = await drawer()
    await pick(sheet, 'Repeat', 'Weekly on Thursday')
    await expect(await sheet.findByText('Every week on Thu')).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Thursday' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.type(await titleField(), 'Weekly check-in')
    await userEvent.click(sheet.getByRole('button', { name: 'Schedule' }))
    await toastShows('Session scheduled.')
    await expect(await sheet.findByText(/Every week on Thu/)).toBeVisible()
  },
}

/** Custom…: every 2 weeks on Tuesdays and Thursdays until a date; the menu then says Custom. */
export const RecurringSummary: Story = {
  render: () => <Drawer start={create({ date: '2026-12-01' })} />,
  play: async () => {
    const sheet = await drawer()
    await pick(sheet, 'Repeat', 'Custom…')
    await userEvent.click(sheet.getByRole('button', { name: 'Thursday' }))
    await pick(sheet, 'Every', '2')
    await userEvent.click(sheet.getByRole('radio', { name: 'On a date' }))
    fireEvent.change(field('until'), { target: { value: '2027-06-30' } })
    await expect(
      await sheet.findByText('Every 2 weeks on Tue and Thu until 30 Jun 2027, 31 sessions'),
    ).toBeVisible()
    await expect(picker(sheet, 'Repeat')).toHaveAccessibleName(/Custom…/)
  },
}

/** Custom monthly: on the first Tuesday, ten times. */
export const CustomMonthly: Story = {
  render: () => <Drawer start={create({ date: '2026-12-01' })} />,
  play: async () => {
    const sheet = await drawer()
    await pick(sheet, 'Repeat', 'Custom…')
    await pick(sheet, 'Frequency', 'month')
    await expect(await sheet.findByText('Every month on day 1')).toBeVisible()
    await pick(sheet, 'On', 'The first Tuesday')
    await userEvent.click(sheet.getByRole('radio', { name: 'After' }))
    await expect(
      await sheet.findByText('Every month on the first Tuesday, 10 sessions'),
    ).toBeVisible()
  },
}

/** The slot overlaps another session and a busy time: one line under the time, the fields below stay put. */
export const ConflictsWarning: Story = {
  render: () => <Drawer start={create({ date: '2026-12-02', minutes: 9 * 60 + 30 })} />,
  play: async () => {
    const sheet = await drawer()
    await expect(await sheet.findByText(/1 overlap: /)).toBeVisible()
    await sheet.findByRole('button', { name: /^Event type/ })
    const repeat = picker(sheet, 'Repeat')
    const before = repeat.getBoundingClientRect().top
    await expect(sheet.getByText(/Strategy session/)).toBeVisible()
    await expect(repeat.getBoundingClientRect().top).toBe(before)
    // Moving the time onto the busy block names it without a title.
    fireEvent.change(field('time'), { target: { value: '14:00' } })
    await expect(await sheet.findByText(/busy in the host’s calendar/)).toBeVisible()
    await expect(repeat.getBoundingClientRect().top).toBe(before)
  },
}

/** Google Meet works (my Google calendar is connected); Teams is offered but not connected: a link to connect it. */
export const MeetConnectLink: Story = {
  play: async () => {
    const sheet = await drawer()
    const connect = await sheet.findByRole('link', {
      name: /Connect your Microsoft 365 calendar/,
    })
    await expect(connect).toHaveAttribute('href', '/settings/scheduling#calendars')
    await expect(sheet.queryByRole('button', { name: 'Microsoft Teams' })).not.toBeInTheDocument()
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

/** An installation without calendar keys: no Meet or Teams at all, only in person or one's own link. */
export const MeetHiddenWhenNotConfigured: Story = {
  parameters: {
    msw: {
      handlers: [
        team,
        clients,
        http.get('/api/v1/scheduling/calendars', () =>
          HttpResponse.json({ providers: [], data: [] }),
        ),
        ...schedulingHandlers(state),
        plainClient,
      ],
    },
  },
  play: async () => {
    const sheet = await drawer()
    await userEvent.click(await sheet.findByRole('button', { name: 'My own link' }))
    await expect(sheet.getByRole('textbox', { name: 'Meeting link' })).toBeVisible()
    await expect(sheet.queryByText('Google Meet')).not.toBeInTheDocument()
    await expect(sheet.queryByText('Microsoft Teams')).not.toBeInTheDocument()
    await userEvent.click(sheet.getByRole('button', { name: 'In person' }))
    await expect(sheet.getByRole('textbox', { name: 'Location' })).toHaveValue('Office')
  },
}

/** The notes stay behind two quiet buttons until wanted. */
export const NotesExpand: Story = {
  play: async () => {
    const sheet = await drawer()
    await expect(sheet.queryByRole('textbox', { name: /Note for the client/ })).toBeNull()
    await userEvent.click(sheet.getByRole('button', { name: 'Add note for client' }))
    const note = await sheet.findByRole('textbox', { name: /Note for the client/ })
    await waitFor(() => expect(note).toHaveFocus())
    await userEvent.type(note, 'Bring the plans.')
    await expect(sheet.queryByRole('button', { name: 'Add note for client' })).toBeNull()
    await userEvent.click(sheet.getByRole('button', { name: 'Add internal note' }))
    await expect(await sheet.findByRole('textbox', { name: /Internal notes/ })).toBeVisible()
  },
}

/** The client comes first, before the event type. */
export const ClientFirst: Story = {
  play: async () => {
    const sheet = await drawer()
    const type = await sheet.findByRole('button', { name: /^Event type/ })
    const client = sheet.getByRole('button', { name: /^Client/ })
    await expect(
      client.compareDocumentPosition(type) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}

/** Each row's icon sits on its first line: an open note's label, not the middle of its box. */
export const NotesAlignment: Story = {
  play: async () => {
    const sheet = await drawer()
    await userEvent.click(sheet.getByRole('button', { name: 'Add note for client' }))
    await sheet.findByRole('textbox', { name: /Note for the client/ })
    const label = sheet.getByText('Note for the client', { selector: 'label' })
    const icon = label.closest('[data-row]')?.querySelector('[data-row-icon]')
    if (!icon) throw new Error('No row icon')
    const box = icon.getBoundingClientRect()
    const text = label.getBoundingClientRect()
    await expect(Math.abs(box.top - text.top)).toBeLessThanOrEqual(1)
    await expect(
      Math.abs(box.top + box.height / 2 - (text.top + text.height / 2)),
    ).toBeLessThanOrEqual(1)
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
        plainClient,
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
    // Edit lives in the "…" menu, in its Edit group after the view actions: no separate pencil in the header.
    await expect(sheet.queryByRole('button', { name: 'Edit session' })).not.toBeInTheDocument()
    await userEvent.click(sheet.getByRole('button', { name: 'More actions' }))
    const items = await screen.findAllByRole('menuitem')
    await expect(items.at(-1)).toHaveAccessibleName('Edit session')
    await userEvent.click(items.at(-1)!)
    await sheet.findByRole('heading', { name: 'Edit session' })
    fireEvent.change(field('time'), { target: { value: '10:00' } })
    await userEvent.click(sheet.getByRole('button', { name: 'Save changes' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Change a recurring session' }))
    await userEvent.click(dialog.getByRole('radio', { name: /All sessions/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await toastShows('Saved. 1 changed session kept its own time.')
  },
}

const blockedItem = (
  id: string,
  reason: MoveItem['reason'],
  extra: Partial<MoveItem> = {},
): MoveItem => ({
  occurrence_id: id,
  starts_at: '2026-12-22T08:00:00Z',
  ends_at: '2026-12-22T09:00:00Z',
  moves_to: '2026-12-22T09:00:00Z',
  status: 'scheduled',
  reason,
  moves: false,
  ...extra,
})
// Far ahead: a time picked by hand must not have passed, whenever the stories run.
const OWN_AT = '2030-01-08T12:00:00Z'
const BLOCKED: MovePreview = {
  moving: 9,
  sample: [],
  items: [
    blockedItem('soc_off', 'day_off', { day_off: 'Closing day' }),
    blockedItem('soc_own', 'exception', {
      starts_at: OWN_AT,
      ends_at: '2030-01-08T13:00:00Z',
      moves_to: '2030-01-08T09:00:00Z',
      status: 'rescheduled',
    }),
    blockedItem('soc_now', 'started', { starts_at: '2026-12-01T08:00:00Z', moves_to: null }),
    blockedItem('soc_busy', 'conflict', {
      moves: true,
      starts_at: '2027-01-05T08:00:00Z',
      ends_at: '2027-01-05T09:00:00Z',
      moves_to: '2027-01-05T09:00:00Z',
      conflicts: [
        {
          kind: 'event',
          title: 'Strategy call',
          starts_at: '2027-01-05T08:30:00Z',
          ends_at: '2027-01-05T09:30:00Z',
        },
      ],
    }),
  ],
}
const MONTHLY: MovePreview = {
  moving: 0,
  sample: [],
  items: [blockedItem('soc_series_2', 'monthly_rule', { moves_to: null })],
}
const patched = fn()
/** Answers the move's preview with `preview`; the save itself goes on to the fake. */
const previewWith = (preview: MovePreview) =>
  http.patch('/api/v1/scheduling/occurrences/:id', async ({ request }) => {
    const body = (await request.clone().json()) as Record<string, unknown>
    patched(body)
    if (body.dry_run) return HttpResponse.json({ data: preview })
    return undefined
  })
/** A time picked by hand at 11:00 on 8 Jan 2030 overlaps a team meeting; any other is free. */
const pickedCheck = http.get('/api/v1/scheduling/conflicts', ({ request }) => {
  const at = new URL(request.url).searchParams.get('starts_at')
  return HttpResponse.json({
    data:
      at === '2030-01-08T10:00:00.000Z'
        ? [
            {
              kind: 'event',
              title: 'Team meeting',
              starts_at: '2030-01-08T10:00:00Z',
              ends_at: '2030-01-08T11:00:00Z',
            },
          ]
        : [],
  })
})
const blockedParameters = (preview: MovePreview) => ({
  msw: {
    handlers: [
      previewWith(preview),
      pickedCheck,
      team,
      clients,
      ...schedulingHandlers(state),
      plainClient,
    ],
  },
})
/** Edits the series' session to 10:00 and applies it to all sessions: the preview answers. */
const moveAll = async () => {
  patched.mockClear()
  const sheet = await drawer()
  await userEvent.click(await sheet.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit session' }))
  await sheet.findByRole('heading', { name: 'Edit session' })
  fireEvent.change(field('time'), { target: { value: '10:00' } })
  await userEvent.click(sheet.getByRole('button', { name: 'Save changes' }))
  const scope = within(await screen.findByRole('dialog', { name: 'Change a recurring session' }))
  await userEvent.click(scope.getByRole('radio', { name: /All sessions/ }))
  await userEvent.click(scope.getByRole('button', { name: 'Apply' }))
}
const blockedRow = (reason: string) => {
  const row = document.querySelector<HTMLElement>(`[data-move-item="${reason}"]`)
  if (!row) throw new Error(`No ${reason} row`)
  return within(row)
}
const DECIDE = '3 sessions need your decision'
const summary = () => document.querySelector('[data-move-summary]')

/**
 * Sessions that need a look: each shows where it is, where it would go and why in plain words, with a decision.
 * Move anyway onto the day off, keep the overlapping one, pick another time for the one moved on its own (checked as
 * it changes), and the footer counts it all; Apply saves the decisions with the move.
 */
export const SeriesMoveDecisions: Story = {
  parameters: blockedParameters(BLOCKED),
  render: () => <Drawer start={{ kind: 'view', id: 'soc_series_2' }} />,
  play: async () => {
    await moveAll()
    const dialog = within(await screen.findByRole('dialog', { name: DECIDE }))
    await expect(
      dialog.getByText(
        'Moving the series from Tuesday 09:00 to Tuesday 10:00. 8 sessions move without problems.',
      ),
    ).toBeVisible()
    await expect(summary()).toHaveTextContent('8 move · 1 moved anyway · 1 kept · 1 skipped')
    // No status badge: the old "Moved" is gone, the reason says it.
    await expect(dialog.queryByText('Moved')).not.toBeInTheDocument()

    // Day off: skipped as the series does, unless moved anyway.
    const off = blockedRow('day_off')
    await expect(off.getByText('Tue 22 Dec, 09:00')).toBeVisible()
    await expect(off.getByText('Tue 22 Dec, 10:00')).toBeVisible()
    await expect(
      off.getByText('Tue 22 Dec is a day off (Closing day), and this series skips days off.'),
    ).toBeVisible()
    await expect(off.getByRole('button', { name: 'Skip this date' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(off.getByRole('button', { name: 'Move anyway' }))

    // Started: only told.
    await expect(
      blockedRow('started').getByText('This session has already started, so it keeps its time.'),
    ).toBeVisible()
    await expect(blockedRow('started').queryByRole('button')).not.toBeInTheDocument()

    // An overlap names what it overlaps; keep it on its day.
    const busy = blockedRow('conflict')
    await expect(busy.getByText('Overlaps “Strategy call”, 09:30–10:30.')).toBeVisible()
    await userEvent.click(busy.getByRole('button', { name: 'Keep on Tuesday' }))

    // Moved on its own: pick another time, checked live.
    const own = blockedRow('exception')
    await expect(
      own.getByText('You already moved this session on its own to Tue 8 Jan, 13:00.'),
    ).toBeVisible()
    await userEvent.click(own.getByRole('button', { name: 'Pick another time…' }))
    await expect(await own.findByText('Free at this time.')).toBeVisible()
    fireEvent.change(own.getByLabelText('New time'), { target: { value: '11:00' } })
    await expect(await own.findByText('Overlaps “Team meeting”, 11:00–12:00.')).toBeVisible()
    fireEvent.change(own.getByLabelText('New time'), { target: { value: '12:00' } })
    await expect(await own.findByText('Free at this time.')).toBeVisible()

    await expect(summary()).toHaveTextContent('8 move · 1 moved anyway · 1 kept · 1 rescheduled')
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: DECIDE })).toBeNull())
    await expect(patched).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: 'all',
        starts_local: '2026-12-08T10:00',
        decisions: {
          soc_off: 'move_anyway',
          soc_busy: 'keep',
          soc_own: 'move_to:2030-01-08T11:00:00.000Z',
        },
      }),
    )
    await expect(patched.mock.lastCall?.[0]).not.toHaveProperty('dry_run')
  },
}

/** A time picked by hand that has passed is refused before saving. */
export const SeriesMovePickedTimePassed: Story = {
  parameters: blockedParameters(BLOCKED),
  render: () => <Drawer start={{ kind: 'view', id: 'soc_series_2' }} />,
  play: async () => {
    await moveAll()
    const dialog = within(await screen.findByRole('dialog', { name: DECIDE }))
    const own = blockedRow('exception')
    await userEvent.click(own.getByRole('button', { name: 'Pick another time…' }))
    fireEvent.change(own.getByLabelText('New date'), { target: { value: '2020-01-07' } })
    await expect(await own.findByText("Pick a time that hasn't passed.")).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled()
  },
}

/** Cancel in the list changes nothing: only the preview was asked. */
export const SeriesMoveBlockedCancel: Story = {
  parameters: blockedParameters(BLOCKED),
  render: () => <Drawer start={{ kind: 'view', id: 'soc_series_2' }} />,
  play: async () => {
    await moveAll()
    const dialog = within(await screen.findByRole('dialog', { name: DECIDE }))
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: DECIDE })).toBeNull())
    await expect(patched).toHaveBeenCalledTimes(1)
    await expect(patched.mock.lastCall?.[0]).toHaveProperty('dry_run', true)
  },
}

/** A rule on a day of the month can't move by days: nothing moves, and the repeat rule is one click away. */
export const SeriesMoveMonthlyRule: Story = {
  parameters: blockedParameters(MONTHLY),
  render: () => <Drawer start={{ kind: 'view', id: 'soc_series_2' }} />,
  play: async () => {
    await moveAll()
    const dialog = within(await screen.findByRole('dialog', { name: 'Check these sessions first' }))
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await userEvent.click(dialog.getByRole('button', { name: 'Change the repeat rule…' }))
    await waitFor(() => expect(document.activeElement).toBe(field('repeat')))
  },
}

const openRecord = fn()

/** "Open engagement" and the details' engagement and client open their drawers in place, stacked: no page change. */
export const OpenEngagementInPlace: Story = {
  render: () => (
    <RecordDrawersContext value={openRecord}>
      <Drawer start={{ kind: 'view', id: 'soc_series_2' }} />
    </RecordDrawersContext>
  ),
  play: async () => {
    openRecord.mockClear()
    const sheet = await drawer()
    await userEvent.click(await sheet.findByRole('button', { name: 'More actions' }))
    const item = await screen.findByRole('menuitem', { name: 'Open engagement' })
    // A menu action, not a link to the engagements page.
    await expect(item).not.toHaveAttribute('href')
    await userEvent.click(item)
    await expect(openRecord).toHaveBeenLastCalledWith({ kind: 'engagement', id: 'eng_1' })
    await userEvent.click(await sheet.findByRole('link', { name: '#7 Coaching package' }))
    await expect(openRecord).toHaveBeenLastCalledWith({ kind: 'engagement', id: 'eng_1' })
    await userEvent.click(await sheet.findByRole('link', { name: 'Keller Holzbau AG' }))
    await expect(openRecord).toHaveBeenLastCalledWith({ kind: 'client', id: 'cli_02' })
    // The session stays open underneath.
    await expect(sheet.getByRole('heading', { name: 'Coaching' })).toBeVisible()
  },
}

/** A session that has started: its time shows a lock, and the edit form keeps date, start and length read-only. */
export const StartedSessionTimeLocked: Story = {
  render: () => <Drawer start={{ kind: 'view', id: 'soc_mark' }} />,
  play: async () => {
    const sheet = await drawer()
    const reason = "This session has started; its time can't change."
    await expect(await sheet.findByLabelText(reason)).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'More actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit session' }))
    await expect(await sheet.findByRole('heading', { name: 'Edit session' })).toBeVisible()
    await expect(field('date')).toHaveAttribute('readonly')
    await expect(field('time')).toHaveAttribute('readonly')
    await expect(sheet.queryByRole('button', { name: '45 min' })).not.toBeInTheDocument()
    await expect(sheet.queryByRole('button', { name: 'Change duration' })).not.toBeInTheDocument()
    const lock = sheet.getByLabelText(reason)
    await userEvent.hover(lock)
    await expect(await screen.findByRole('tooltip')).toHaveTextContent(reason)
  },
}

/** Attended is green, No-show amber, Cancel red, all soft tints; one the session cannot take yet is muted and says why. */
export const StatusActionColours: Story = {
  render: () => <Drawer start={{ kind: 'view', id: 'soc_mark' }} />,
  play: async () => {
    const sheet = await drawer()
    const attended = await sheet.findByRole('button', { name: 'Attended' })
    await expect(attended).toHaveAttribute('data-variant', 'success-soft')
    await expect(attended).toBeEnabled()
    await expect(sheet.getByRole('button', { name: 'No-show' })).toHaveAttribute(
      'data-variant',
      'warning-soft',
    )
    const cancel = sheet.getByRole('button', { name: 'Cancel session' })
    await expect(cancel).toHaveAttribute('data-variant', 'destructive-soft')
    await expect(getComputedStyle(attended).backgroundColor).not.toBe(
      getComputedStyle(cancel).backgroundColor,
    )
  },
}

export const StatusActionColoursDark: Story = { ...StatusActionColours, parameters: { dark: true } }

/** Before the session starts, Attended and No-show stay in place, muted, and their tooltip says why. */
export const StatusActionNotYet: Story = {
  render: () => <Drawer start={{ kind: 'view', id: 'soc_series_2' }} />,
  play: async () => {
    const sheet = await drawer()
    const attended = await sheet.findByRole('button', { name: 'Attended' })
    await expect(attended).toHaveAttribute('aria-disabled', 'true')
    const cancel = sheet.getByRole('button', { name: 'Cancel session' })
    await expect(getComputedStyle(attended).backgroundColor).not.toBe(
      getComputedStyle(cancel).backgroundColor,
    )
    await userEvent.hover(attended)
    await expect(
      await screen.findByRole('tooltip', { name: 'Possible once the session has started.' }),
    ).toBeInTheDocument()
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
  parameters: { msw: { handlers: [team, ...schedulingHandlers(emptyState()), plainClient] } },
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
      /^\/scheduling\/?\?session=soc_1$/,
    )
  },
}

/** A company's participants: the session names who takes it, and its mail goes to them. */
export const ParticipantPicker: Story = {
  parameters: {
    msw: {
      handlers: [
        team,
        clients,
        http.get('/api/v1/clients/cli_01', () =>
          HttpResponse.json({
            data: {
              ...ALPENGLOW,
              is_company: true,
              contacts: [
                {
                  id: 'con_oliver',
                  name: 'Oliver Harvey',
                  roles: ['contact'],
                  email: 'oliver@alpenglow.ch',
                  is_primary: true,
                },
                {
                  id: 'con_lorenzo',
                  name: 'Lorenzo Percic',
                  roles: ['participant'],
                  email: 'lorenzo@alpenglow.ch',
                  is_primary: false,
                },
                {
                  id: 'con_liam',
                  name: 'Liam Gallagher',
                  roles: ['contact', 'participant'],
                  email: null,
                  is_primary: false,
                },
              ],
            },
          }),
        ),
        ...schedulingHandlers(state),
        plainClient,
      ],
    },
  },
  play: async () => {
    const sheet = await drawer()
    await pick(sheet, 'Participant', 'Lorenzo Percic lorenzo@alpenglow.ch')
    await expect(picker(sheet, 'Participant')).toHaveAccessibleName(/Lorenzo Percic/)
    await userEvent.type(await titleField(), 'German lesson')
    await userEvent.click(sheet.getByRole('button', { name: 'Schedule' }))
    await toastShows('Session scheduled.')
    await expect(await sheet.findByText('Lorenzo Percic')).toBeVisible()
  },
}

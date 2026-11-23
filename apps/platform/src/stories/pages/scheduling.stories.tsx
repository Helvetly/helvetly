import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

import { HOURS_KEY } from '@/components/scheduling/hours-menu'
import { SchedulingPage } from '@/components/scheduling/scheduling-page'
import { instantOf } from '@/lib/scheduling'
import {
  emptyState,
  event,
  occurrence,
  sampleState,
  schedulingHandlers,
  STORY_NOW,
  TEAM,
  type SchedulingState,
} from '@/mocks/scheduling'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone } from './frame'

const team = http.get('/api/v1/members', () => HttpResponse.json({ data: TEAM }))
const shared = sampleState()
const toastShows = (text: string) =>
  waitFor(() => expect(within(document.body).getByText(text)).toBeVisible())
const withState = (state: SchedulingState, query: Record<string, string> = {}) =>
  pageParameters('/scheduling', query, [team, ...schedulingHandlers(state)])

const meta = {
  title: 'Pages/Scheduling',
  // Every story starts from the same sessions, whatever the last one wrote.
  beforeEach: () => {
    closeHeidi()
    Object.assign(shared, sampleState())
    localStorage.removeItem(VIEW_KEY)
    localStorage.removeItem(HOURS_KEY)
  },
  parameters: withState(shared),
  render: () => (
    <Frame>
      <SchedulingPage now={STORY_NOW} />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const VIEW_KEY = 'helvetly.scheduling.view'
const body = () => within(document.body)
const pastCount = () => document.querySelectorAll('[data-past]').length
const everyone = async () => {
  await userEvent.click(await body().findByRole('radio', { name: 'Everyone' }))
}

/** My week: my sessions by colour, a busy block from my calendar, the requests and "to mark" strips on top. */
export const Week: Story = {
  play: async () => {
    const page = body()
    await expect(
      await page.findByRole('heading', { name: '30 Nov 2026 – 6 Dec 2026' }),
    ).toBeVisible()
    await expect(await page.findByRole('button', { name: /Strategy session/ })).toBeVisible()
    // Another host's session is not mine.
    await expect(page.queryByRole('button', { name: /Design review/ })).not.toBeInTheDocument()
    await expect(page.getByText('Busy')).toBeInTheDocument()
    await expect(page.getByRole('button', { name: '2 requests waiting' })).toBeVisible()
    await expect(page.getByRole('button', { name: '1 session to mark' })).toBeVisible()
    // Monday, Tuesday and the morning of Wednesday (09:30 in Zurich) are past and hatched.
    await expect(pastCount()).toBe(3)
    // A past slot is no place for a new session: 09:00 is offered Thursday to Sunday, 09:30 from Wednesday.
    await expect(
      page.getAllByRole('button', { name: /^New session on .* at 09:00$/ }),
    ).toHaveLength(4)
    await expect(
      page.getAllByRole('button', { name: /^New session on .* at 09:30$/ }),
    ).toHaveLength(5)
  },
}
export const WeekDark = dark(Week)

/** Per day heading: whether its left and right edges are within 1 px of its column's under it. */
const aligned = () =>
  [...document.querySelectorAll<HTMLElement>('[data-day-heading]')].map((heading) => {
    const top = heading.getBoundingClientRect()
    const bottom = document
      .querySelector(`[data-day-column="${heading.dataset.dayHeading}"]`)
      ?.getBoundingClientRect()
    return (
      !!bottom && Math.abs(top.left - bottom.left) <= 1 && Math.abs(top.right - bottom.right) <= 1
    )
  })

/** Each day heading sits exactly over its column, scrollbar or not: heading and body share one column template. */
export const HeadingsAlignWithColumns: Story = {
  play: async () => {
    const page = body()
    await page.findByRole('button', { name: /Strategy session/ })
    await expect(aligned()).toEqual(Array(7).fill(true))
    await everyone()
    await page.findByRole('button', { name: /Design review/ })
    await expect(aligned()).toEqual(Array(7).fill(true))
    await userEvent.click(page.getByRole('radio', { name: 'Day' }))
    await page.findByRole('heading', { name: 'Wednesday, 2 December 2026' })
    await expect(aligned()).toEqual([true])
  },
}

/** Working hours 11:00–14:00: sessions outside them are counted at the column's edge, and a count shows the full day. */
export const WorkingHours: Story = {
  beforeEach: () => {
    localStorage.setItem(HOURS_KEY, JSON.stringify({ mode: 'work', work: { from: 11, to: 14 } }))
  },
  play: async () => {
    const page = body()
    await expect(await page.findByRole('button', { name: /^Show hours:/ })).toHaveTextContent(
      '11:00–14:00',
    )
    await waitFor(() => expect(page.getAllByRole('button', { name: '1 earlier' })).toHaveLength(3))
    // Monday's 14:00 kick-off and Thursday's 15:00 intro call.
    await expect(page.getAllByRole('button', { name: '1 later' })).toHaveLength(2)
    await expect(page.queryByRole('button', { name: /Strategy session/ })).not.toBeInTheDocument()
    await expect(
      page.queryAllByRole('button', { name: /^New session on .* at 10:30$/ }),
    ).toHaveLength(0)
    await expect(
      page.getAllByRole('button', { name: /^New session on .* at 13:30$/ }),
    ).toHaveLength(5)
    await userEvent.click(page.getAllByRole('button', { name: '1 earlier' })[0]!)
    await expect(await page.findByRole('button', { name: /Strategy session/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Show hours:/ })).toHaveTextContent('Full day')
    await expect(page.queryByRole('button', { name: '1 earlier' })).not.toBeInTheDocument()
    await expect(JSON.parse(localStorage.getItem(HOURS_KEY) ?? '{}')).toMatchObject({
      mode: 'full',
      work: { from: 11, to: 14 },
    })
  },
}

/** The full day by default; Working hours suggests 06:00–22:00 and keeps the range whole hours, end after start. */
export const ChooseHours: Story = {
  parameters: withState(sampleState(), { view: 'day' }),
  play: async () => {
    const page = body()
    const trigger = await page.findByRole('button', { name: /^Show hours:/ })
    await expect(trigger).toHaveTextContent('Full day')
    await expect(page.getByRole('button', { name: /^New session on .* at 23:30$/ })).toBeVisible()
    await userEvent.click(trigger)
    await userEvent.click(await page.findByRole('radio', { name: 'Working hours' }))
    await expect(trigger).toHaveTextContent('06:00–22:00')
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'From' }), '08:00')
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'To' }), '18:00')
    await expect(trigger).toHaveTextContent('08:00–18:00')
    await expect(
      page.queryByRole('button', { name: /^New session on .* at 18:00$/ }),
    ).not.toBeInTheDocument()
    await expect(page.getByRole('button', { name: /^New session on .* at 17:30$/ })).toBeVisible()
    // A start at or after the end moves the end one hour past it.
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'From' }), '20:00')
    await expect(trigger).toHaveTextContent('20:00–21:00')
    await expect(JSON.parse(localStorage.getItem(HOURS_KEY) ?? '{}')).toEqual({
      mode: 'work',
      work: { from: 20, to: 21 },
    })
  },
}

/** Everyone with three hosts: each day shows the hosts side by side, overlapping sessions share a lane. */
export const EveryoneSideBySide: Story = {
  play: async () => {
    await everyone()
    const page = body()
    await expect(await page.findByRole('button', { name: /Design review/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Quick check-in/ })).toBeVisible()
    // Lanes are headed by the hosts' first names, once per day.
    await expect(page.getAllByText('Luca')).toHaveLength(7)
  },
}

/** Many overlapping sessions of one host: each takes its own column instead of covering the others. */
export const ManyOverlaps: Story = {
  parameters: withState(
    sampleState({
      occurrences: [0, 15, 30, 45].map((offset, index) =>
        occurrence({
          id: `soc_o${index}`,
          title: `Session ${index + 1}`,
          starts_at: new Date(Date.parse('2026-12-02T09:00:00Z') + offset * 60_000).toISOString(),
        }),
      ),
    }),
    { view: 'day' },
  ),
  play: async () => {
    const page = body()
    const blocks = await Promise.all(
      [1, 2, 3, 4].map((n) => page.findByRole('button', { name: new RegExp(`^Session ${n}`) })),
    )
    const lefts = blocks.map((block) => block.getBoundingClientRect().left)
    await expect(new Set(lefts).size).toBe(4)
  },
}

/** Nothing scheduled: the empty grid fills the page with no sentence under it; a slot schedules one. */
export const Empty: Story = {
  parameters: withState(emptyState()),
  play: async () => {
    const page = body()
    await expect(
      await page.findByRole('heading', { name: '30 Nov 2026 – 6 Dec 2026' }),
    ).toBeVisible()
    await expect(page.queryByText('Nothing scheduled here yet.')).not.toBeInTheDocument()
    await expect(page.queryByRole('button', { name: /requests waiting/ })).not.toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /^New session on .*3.* at 10:00$/ }))
    await expect(await page.findByRole('heading', { name: 'New session' })).toBeVisible()
  },
}

/** The chosen view is remembered: Month is saved, and the next visit without ?view opens on it. */
export const ViewRemembered: Story = {
  beforeEach: () => {
    localStorage.setItem(VIEW_KEY, 'day')
  },
  play: async () => {
    const page = body()
    await expect(
      await page.findByRole('heading', { name: 'Wednesday, 2 December 2026' }),
    ).toBeVisible()
    await userEvent.click(page.getByRole('radio', { name: 'Month' }))
    await expect(await page.findByRole('heading', { name: 'December 2026' })).toBeVisible()
    await expect(localStorage.getItem(VIEW_KEY)).toBe('month')
  },
}

/** The week summer time ends (Sunday 25 October): 09:00 before and after the switch sits at 09:00 both times. */
export const DstWeek: Story = {
  parameters: withState(
    sampleState({
      occurrences: ['2026-10-23', '2026-10-25'].map((date, index) =>
        occurrence({
          id: `soc_dst${index}`,
          title: `Coaching ${index + 1}`,
          starts_at: instantOf(date, 9 * 60, 'Europe/Zurich').toISOString(),
        }),
      ),
    }),
    { date: '2026-10-25' },
  ),
  play: async () => {
    const page = body()
    const before = await page.findByRole('button', { name: /Coaching 1/ })
    const after = await page.findByRole('button', { name: /Coaching 2/ })
    await expect(before).toHaveTextContent('09:00')
    await expect(after).toHaveTextContent('09:00')
    await expect(before.getBoundingClientRect().top).toBe(after.getBoundingClientRect().top)
  },
}

/** A month: a count per day, the day's sessions in a popover, one opens the drawer. */
export const Month: Story = {
  parameters: withState(shared, { view: 'month' }),
  play: async () => {
    const page = body()
    await expect(await page.findByRole('heading', { name: 'December 2026' })).toBeVisible()
    // 30 November and 1 December are past.
    await expect(pastCount()).toBe(2)
    await userEvent.click(
      (await page.findAllByRole('button', { name: '1 session' }))[0] ?? document.body,
    )
    await userEvent.click(await page.findByRole('button', { name: /Kick-off/ }))
    await expect(await page.findByRole('heading', { name: 'Kick-off' })).toBeVisible()
  },
}

/** The list by day with its filters; a status filter narrows it, a CSV of what is shown. */
export const List: Story = {
  parameters: withState(shared, { view: 'list' }),
  play: async () => {
    const page = body()
    await expect(
      await page.findByRole('heading', { name: 'Wednesday, 2 December 2026' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Strategy session/ })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: /^Status/ }))
    await userEvent.click(await page.findByRole('option', { name: 'Requested' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(page.queryByRole('button', { name: /Strategy session/ })).not.toBeInTheDocument(),
    )
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled()
  },
}

/** Phones open on the list; the week does not fit. */
export const Phone = phone({
  play: async () => {
    const page = body()
    await expect(
      await page.findByRole('heading', { name: 'Wednesday, 2 December 2026' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible()
  },
} satisfies Story)

/** "To mark" lists past open sessions; marking one attended takes it off. */
export const ToMark: Story = {
  play: async () => {
    const page = body()
    await userEvent.click(await page.findByRole('button', { name: '1 session to mark' }))
    await expect(await page.findByRole('heading', { name: 'Past sessions to mark' })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: /Kick-off/ }))
    const drawer = within(await page.findByRole('dialog'))
    await userEvent.click(await drawer.findByRole('button', { name: 'Attended' }))
    await toastShows('Marked as attended.')
    await expect(
      await drawer.findByText('Attended', { selector: '[data-slot=badge]' }),
    ).toBeVisible()
  },
}

/** Dragging a one-off session down an hour moves it at once. */
export const DragToMove: Story = {
  parameters: withState(shared, { view: 'day', date: '2026-12-02' }),
  play: async () => {
    const page = body()
    const block = await page.findByRole('button', { name: /Strategy session/ })
    const { left, top } = block.getBoundingClientRect()
    fireEvent.pointerDown(block, { button: 0, clientX: left + 5, clientY: top + 5, pointerId: 1 })
    fireEvent.pointerMove(block, { clientX: left + 5, clientY: top + 85, pointerId: 1 })
    fireEvent.pointerUp(block, { clientX: left + 5, clientY: top + 85, pointerId: 1 })
    await toastShows('Session saved.')
    await waitFor(() =>
      expect(page.getByRole('button', { name: /Strategy session/ })).toHaveTextContent('11:00'),
    )
  },
}

/** Moving one session of a series asks which sessions take the change; "This session" moves only it. */
export const KeyboardMoveInSeries: Story = {
  parameters: withState(shared, { date: '2026-12-04' }),
  play: async () => {
    const page = body()
    const block = (await page.findAllByRole('button', { name: /^Coaching/ })).find((entry) =>
      entry.textContent?.includes('09:00'),
    )
    if (!block) throw new Error('No coaching session at 09:00')
    block.focus()
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    const dialog = within(await page.findByRole('dialog', { name: 'Change a recurring session' }))
    await expect(dialog.getByRole('radio', { name: /This and following/ })).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await toastShows('Session saved.')
  },
}

/** The requests strip opens the requests: a late cancellation, and a move with the client's times. */
export const Requests: Story = {
  play: async () => {
    const page = body()
    await userEvent.click(await page.findByRole('button', { name: '2 requests waiting' }))
    const drawer = within(await page.findByRole('dialog', { name: 'Requests' }))
    await expect(drawer.getByText('Late')).toBeVisible()
    await expect(drawer.getByText('“Our team is at a trade fair that week.”')).toBeVisible()
    // The move: pick the client's second time and approve.
    await userEvent.click(drawer.getByRole('radio', { name: /10 Dec/ }))
    const approve = drawer.getAllByRole('button', { name: 'Approve' })[0]
    if (!approve) throw new Error('No approve button')
    await userEvent.click(approve)
    await toastShows('Request approved; the client is told.')
    await waitFor(() => expect(drawer.queryByText('New time wanted')).not.toBeInTheDocument())
  },
}

/** Proposing needs a time; declining asks for an optional reason for the client. */
export const RequestDecline: Story = {
  play: async () => {
    const page = body()
    await userEvent.click(await page.findByRole('button', { name: '2 requests waiting' }))
    const drawer = within(await page.findByRole('dialog', { name: 'Requests' }))
    await userEvent.click(drawer.getAllByRole('button', { name: 'Decline' })[0] ?? document.body)
    await userEvent.type(
      drawer.getByRole('textbox', { name: 'Reason (optional)' }),
      'Fully booked.',
    )
    await userEvent.click(drawer.getAllByRole('button', { name: 'Decline' })[0] ?? document.body)
    await toastShows('Request declined; the client is told.')
  },
}

/** A reader sees the calendar but no way to schedule, move or mark. */
export const ReadOnly: Story = {
  parameters: pageParameters('/scheduling', {}, [
    team,
    http.get('/api/v1/session', () =>
      HttpResponse.json({
        user: { id: 'usr_story', name: 'Anna Muster', email: 'anna@example.com', avatar_url: null },
        workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
        role: 'member',
        scopes: ['read:scheduling', 'read:clients'],
        onboarded: true,
        csrf_token: 'storybook-only',
      }),
    ),
    ...schedulingHandlers(shared),
  ]),
  play: async () => {
    const page = body()
    await userEvent.click(await page.findByRole('button', { name: /Strategy session/ }))
    const drawer = within(await page.findByRole('dialog'))
    await expect(await drawer.findByRole('heading', { name: 'Strategy session' })).toBeVisible()
    await expect(drawer.queryByRole('button', { name: 'Cancel session' })).not.toBeInTheDocument()
    await expect(drawer.queryByRole('button', { name: 'Edit session' })).not.toBeInTheDocument()
    await expect(page.queryByRole('button', { name: 'New session' })).not.toBeInTheDocument()
  },
}

/** A session that has not started cannot be marked yet; the reason is in the tooltip. Cancelling suggests late. */
export const StatusActionsBeforeStart: Story = {
  parameters: withState(
    sampleState({
      events: [event()],
      occurrences: [occurrence({ starts_at: '2026-12-02T10:00:00Z' })],
    }),
    { session: 'soc_1' },
  ),
  play: async () => {
    const page = body()
    const drawer = within(await page.findByRole('dialog'))
    const attended = await drawer.findByRole('button', { name: 'Attended' })
    await expect(attended).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(drawer.getByRole('button', { name: 'Cancel session' }))
    const cancel = within(await page.findByRole('dialog', { name: 'Cancel this session?' }))
    // Within 24 hours of the start: the policy calls it late.
    await expect(cancel.getByRole('radio', { name: 'Late' })).toBeChecked()
    await expect(cancel.getByText('A late cancellation counts as a used session.')).toBeVisible()
    await userEvent.click(cancel.getByRole('button', { name: 'Cancel session' }))
    await toastShows('Session cancelled.')
  },
}

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
    localStorage.removeItem(LAYOUT_KEY)
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
const LAYOUT_KEY = 'helvetly.scheduling.layout'
const body = () => within(document.body)
const pastCount = () => document.querySelectorAll('[data-past]').length
/** Opens the one view menu, named by the current view. */
const viewMenu = async () => {
  await userEvent.click(await body().findByRole('button', { name: /^Calendar view:/ }))
  return within(await body().findByRole('menu'))
}
const pickView = async (name: string) => {
  await userEvent.click((await viewMenu()).getByRole('menuitemradio', { name }))
}
const peopleMenu = async () => {
  await userEvent.click(await body().findByRole('button', { name: /^Hosts:/ }))
  return within(await body().findByRole('menu'))
}
const closeMenu = async () => {
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(body().queryByRole('menu')).not.toBeInTheDocument())
}
const everyone = async () => {
  await userEvent.click((await peopleMenu()).getByRole('menuitemradio', { name: 'Everyone' }))
}
/** Text on the primary fill uses its foreground token, so it reads in light and dark. */
const readsOnPrimary = (element: Element | null) => {
  if (!element) throw new Error('No element on the primary fill')
  expect(element).toHaveClass('bg-primary', 'text-primary-foreground')
  const style = getComputedStyle(element)
  expect(style.color).not.toBe(style.backgroundColor)
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
    // Busy times, requests and sessions to mark are requests of their own: wait for each.
    await expect(await page.findByText('Busy')).toBeInTheDocument()
    await expect(await page.findByRole('button', { name: '2 requests waiting' })).toBeVisible()
    await expect(await page.findByRole('button', { name: '1 session to mark' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Calendar view:/ })).toHaveTextContent('Week')
    await expect(page.getByRole('button', { name: /^Hosts:/ })).toHaveTextContent('My sessions')
    // The now pill on the blue line: white text on the primary fill.
    readsOnPrimary(document.querySelector('[data-now-pill]'))
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
    await pickView('Day')
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
    const menu = await viewMenu()
    await expect(menu.getByRole('menuitemradio', { name: /^Working hours/ })).toHaveTextContent(
      '11:00–14:00',
    )
    await expect(menu.getByRole('menuitemradio', { name: /^Working hours/ })).toBeChecked()
    await closeMenu()
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
    await expect((await viewMenu()).getByRole('menuitemradio', { name: 'Full day' })).toBeChecked()
    await closeMenu()
    await expect(page.queryByRole('button', { name: '1 earlier' })).not.toBeInTheDocument()
    await expect(JSON.parse(localStorage.getItem(HOURS_KEY) ?? '{}')).toMatchObject({
      mode: 'full',
      work: { from: 11, to: 14 },
    })
  },
}

/** The view menu holds the hours: the full day by default; Working hours suggests 06:00–22:00, whole hours, end after start. */
export const ChooseHours: Story = {
  parameters: withState(sampleState(), { view: 'day' }),
  play: async () => {
    const page = body()
    await expect(
      await page.findByRole('button', { name: /^New session on .* at 23:30$/ }),
    ).toBeVisible()
    let menu = await viewMenu()
    await expect(menu.getByRole('menuitemradio', { name: 'Full day' })).toBeChecked()
    const work = menu.getByRole('menuitemradio', { name: /^Working hours/ })
    await userEvent.click(work)
    // The menu stays open for the range.
    await expect(work).toBeChecked()
    await expect(work).toHaveTextContent('06:00–22:00')
    await userEvent.selectOptions(menu.getByRole('combobox', { name: 'From' }), '08:00')
    await userEvent.selectOptions(menu.getByRole('combobox', { name: 'To' }), '18:00')
    await expect(work).toHaveTextContent('08:00–18:00')
    await closeMenu()
    await expect(
      page.queryByRole('button', { name: /^New session on .* at 18:00$/ }),
    ).not.toBeInTheDocument()
    await expect(page.getByRole('button', { name: /^New session on .* at 17:30$/ })).toBeVisible()
    // A start at or after the end moves the end one hour past it.
    menu = await viewMenu()
    await userEvent.selectOptions(menu.getByRole('combobox', { name: 'From' }), '20:00')
    await expect(menu.getByRole('menuitemradio', { name: /^Working hours/ })).toHaveTextContent(
      '20:00–21:00',
    )
    await expect(JSON.parse(localStorage.getItem(HOURS_KEY) ?? '{}')).toEqual({
      mode: 'work',
      work: { from: 20, to: 21 },
    })
    await closeMenu()
  },
}

/** One menu switches the period and the layout; the choice goes into the URL and is remembered. Month has no hours. */
export const ViewMenuSwitches: Story = {
  play: async () => {
    const page = body()
    await page.findByRole('button', { name: /Strategy session/ })
    await pickView('Month')
    await expect(await page.findByRole('heading', { name: 'December 2026' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Calendar view:/ })).toHaveTextContent('Month')
    const menu = await viewMenu()
    await expect(menu.queryByRole('menuitemradio', { name: 'Full day' })).not.toBeInTheDocument()
    await userEvent.click(menu.getByRole('menuitemradio', { name: 'List' }))
    await expect(await page.findByRole('button', { name: 'Export CSV' })).toBeVisible()
    await expect(localStorage.getItem(LAYOUT_KEY)).toBe('list')
    await expect(new URLSearchParams(window.location.search).get('layout')).toBe('list')
    await pickView('Day')
    await expect(
      await page.findByRole('heading', { name: 'Wednesday, 2 December 2026', level: 2 }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible()
    await userEvent.click((await viewMenu()).getByRole('menuitemradio', { name: 'Calendar' }))
    await expect(await page.findByRole('button', { name: /Strategy session/ })).toBeVisible()
    await expect(page.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument()
    await expect(localStorage.getItem(VIEW_KEY)).toBe('day')
  },
}

/** One people filter: my sessions by default, everyone, or the hosts ticked (two side by side). */
export const PeopleFilter: Story = {
  play: async () => {
    const page = body()
    await page.findByRole('button', { name: /Strategy session/ })
    let menu = await peopleMenu()
    await expect(menu.getByRole('menuitemradio', { name: 'My sessions' })).toBeChecked()
    await userEvent.click(menu.getByRole('menuitemcheckbox', { name: 'Luca Rossi' }))
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Luca Rossi' })).toBeChecked()
    await closeMenu()
    await expect(page.getByRole('button', { name: /^Hosts:/ })).toHaveTextContent('Luca Rossi')
    await expect(await page.findByRole('button', { name: /Design review/ })).toBeVisible()
    await waitFor(() =>
      expect(page.queryByRole('button', { name: /Strategy session/ })).not.toBeInTheDocument(),
    )
    menu = await peopleMenu()
    await userEvent.click(menu.getByRole('menuitemcheckbox', { name: 'Mia Keller' }))
    await closeMenu()
    await expect(page.getByRole('button', { name: /^Hosts:/ })).toHaveTextContent('2 hosts')
    await expect(await page.findByRole('button', { name: /Quick check-in/ })).toBeVisible()
    await expect(page.getAllByText('Luca')).toHaveLength(7)
    await userEvent.click((await peopleMenu()).getByRole('menuitemradio', { name: 'My sessions' }))
    await expect(page.getByRole('button', { name: /^Hosts:/ })).toHaveTextContent('My sessions')
    await expect(await page.findByRole('button', { name: /Strategy session/ })).toBeVisible()
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
    await pickView('Month')
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
    // Today's number on its blue circle: white text on the primary fill.
    readsOnPrimary(document.querySelector('[data-today]'))
    await userEvent.click(
      (await page.findAllByRole('button', { name: '1 session' }))[0] ?? document.body,
    )
    await userEvent.click(await page.findByRole('button', { name: /Kick-off/ }))
    await expect(await page.findByRole('heading', { name: 'Kick-off' })).toBeVisible()
  },
}

export const MonthDark = dark(Month)

/** The agenda (an old ?view=list link opens it): days with a date column, today circled, a month line where the week crosses one, filters in one popover. */
export const List: Story = {
  parameters: withState(shared, { view: 'list' }),
  play: async () => {
    const page = body()
    await expect(
      await page.findByRole('heading', { name: 'Wednesday, 2 December 2026' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^Calendar view:/ })).toHaveTextContent('List')
    // Only days with sessions, each once: Monday's kick-off and Wednesday's sessions.
    const days = [...document.querySelectorAll<HTMLElement>('[data-list-day]')].map(
      (day) => day.dataset.listDay,
    )
    await expect(days).toEqual(expect.arrayContaining(['2026-11-30', '2026-12-02']))
    await expect(new Set(days).size).toBe(days.length)
    // The week runs from November into December: a month line before each.
    await expect(
      [...document.querySelectorAll<HTMLElement>('[data-month]')].map((line) => line.textContent),
    ).toEqual(['November 2026', 'December 2026'])
    readsOnPrimary(document.querySelector('[data-today]'))
    await expect(document.querySelectorAll('[data-today]')).toHaveLength(1)
    // A past day's date is muted.
    await expect(document.querySelector('[data-list-day="2026-11-30"] h3')).toHaveClass(
      'text-muted-foreground',
    )
    await expect(page.getByRole('button', { name: /Strategy session/ })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: /^Filters/ }))
    const filters = within(await page.findByRole('dialog', { name: 'Filters' }))
    await userEvent.click(filters.getByRole('button', { name: /^Status/ }))
    await userEvent.click(await page.findByRole('option', { name: 'Requested' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(page.queryByRole('button', { name: /Strategy session/ })).not.toBeInTheDocument(),
    )
    await expect(page.getByRole('button', { name: /^Filters/ })).toHaveTextContent('1')
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled()
    // A row opens the session in the drawer, from the keyboard too.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
    const row = await page.findByRole('button', { name: /Intro call/ })
    row.focus()
    await userEvent.keyboard('{Enter}')
    await expect(await page.findByRole('heading', { name: 'Intro call' })).toBeVisible()
  },
}
export const ListDark = dark(List)

/** An empty period in the list: one quiet line and a way to schedule, no big picture. */
export const ListEmpty: Story = {
  parameters: withState(emptyState(), { layout: 'list' }),
  play: async () => {
    const page = body()
    await expect(await page.findByText('No sessions in this period.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
    const actions = page.getAllByRole('button', { name: 'New session' })
    await userEvent.click(actions.at(-1) ?? document.body)
    await expect(await page.findByRole('heading', { name: 'New session' })).toBeVisible()
  },
}

/** The card under the page header keeps its rounded top corners in every layout: the grid's sticky headings stay inside it. */
export const CardCorners: Story = {
  play: async () => {
    const page = body()
    await page.findByRole('button', { name: /Strategy session/ })
    const card = document.querySelector<HTMLElement>('[data-sched-card]')
    if (!card) throw new Error('No scheduling card')
    const check = () => {
      const style = getComputedStyle(card)
      expect(parseFloat(style.borderTopLeftRadius)).toBeGreaterThan(0)
      expect(parseFloat(style.borderTopRightRadius)).toBeGreaterThan(0)
      expect(style.overflow).toBe('hidden')
      const box = card.getBoundingClientRect()
      const heading = document.querySelector('[data-day-heading]')?.parentElement
      if (heading) {
        const top = heading.getBoundingClientRect()
        expect(top.top).toBeGreaterThanOrEqual(box.top)
        expect(top.left).toBeGreaterThanOrEqual(box.left)
        expect(top.right).toBeLessThanOrEqual(box.right)
      }
    }
    check()
    await pickView('Month')
    await page.findByRole('heading', { name: 'December 2026' })
    check()
    await userEvent.click((await viewMenu()).getByRole('menuitemradio', { name: 'List' }))
    await page.findByRole('button', { name: 'Export CSV' })
    check()
  },
}
export const CardCornersDark = dark(CardCorners)

/** Phones open on the list; the week does not fit. */
export const Phone = phone({
  play: async () => {
    const page = body()
    await expect(
      await page.findByRole('heading', { name: 'Wednesday, 2 December 2026' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^Calendar view:/ })).toHaveTextContent('List')
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

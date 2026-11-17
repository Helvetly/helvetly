import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, waitFor, within } from 'storybook/test'

import { Dashboard } from '@/components/dashboard/dashboard'
import { endedMonths, monthLabel } from '@/components/settings/periods-settings'
import type { Period } from '@/lib/books'
import { today } from '@/lib/invoices'
import { sampleActivity } from '@/mocks/data'

import { sessionHandler } from '../screen-fixtures'
import { closeHeidi, desktop, Frame, pageParameters, shows } from './frame'

// Relative to today, so the stories never age: the three latest ended months, newest first.
const [last = '', previous = '', oldest = ''] = endedMonths(today(), 3)

const closedMonths = (...months: string[]) =>
  months.map((month): Period => ({ month, closed_at: `${last}-28T09:00:00Z`, closed_by: null }))

const periodHandlers = (periods: Period[]) => [
  http.get('/api/v1/periods', () => HttpResponse.json({ data: periods })),
  http.get('/api/v1/periods/activity', ({ request }) => {
    const query = new URL(request.url).searchParams
    return HttpResponse.json({
      data: sampleActivity(query.get('from') ?? '', query.get('to') ?? ''),
    })
  }),
]

const meta = {
  title: 'Pages/Dashboard/Closing reminder',
  beforeEach: closeHeidi,
  render: () => (
    <Frame>
      <Dashboard />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const notShown = async () =>
  waitFor(() =>
    expect(within(document.body).queryByText(/is not closed yet|are not closed yet/)).toBeNull(),
  )

export const OneOpenMonth: Story = {
  parameters: pageParameters('/', {}, periodHandlers(closedMonths(last, previous))),
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    const body = within(document.body)
    await body.findByText(
      `${monthLabel(oldest)} is not closed yet. Close it so its figures can't change.`,
    )
    await expect(body.getByRole('link', { name: 'Close the month' })).toHaveAttribute(
      'href',
      '/settings/periods/',
    )
  },
}

export const SeveralOpenMonths: Story = {
  parameters: pageParameters('/', {}, periodHandlers([])),
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    const body = within(document.body)
    await body.findByText(
      `3 months are not closed yet: ${monthLabel(oldest)} to ${monthLabel(last)}. Close them so their figures can't change.`,
    )
    await expect(body.getByRole('link', { name: 'Close the months' })).toBeVisible()
  },
}

export const NothingToClose: Story = {
  parameters: pageParameters('/', {}, periodHandlers(closedMonths(last, previous, oldest))),
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    await notShown()
  },
}

export const WithoutPermission: Story = {
  parameters: pageParameters('/', {}, [
    sessionHandler({ role: 'member', scopes: ['read:invoices', 'read:expenses'] }),
    ...periodHandlers([]),
  ]),
  play: async (context) => {
    await shows(/Cash flow/i)?.(context)
    await notShown()
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import {
  portalDocuments,
  portalEngagementHistory,
  portalEngagements,
  portalHandlers,
} from '@/mocks/portal'

import { PortalDocuments } from './portal-documents'
import { PortalEngagements } from './portal-engagements'

const meta = {
  title: 'Portal/Lists',
  parameters: { msw: { handlers: portalHandlers } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const P = '/api/v1/public/portal'
const engagements = (data: unknown) => ({
  msw: {
    handlers: [http.get(`${P}/engagements`, () => HttpResponse.json({ data })), ...portalHandlers],
  },
})
const documents = (response: Parameters<typeof http.get>[1]) => ({
  msw: { handlers: [http.get(`${P}/documents`, response), ...portalHandlers] },
})
const retainer = portalEngagements[0]

/** Both sample engagements: one within its hours, one over them. */
export const Engagements: Story = {
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Support retainer')).toBeVisible()
    await expect(canvas.getAllByText('10 hours per month')[0]).toBeVisible()
    await expect(canvas.getAllByRole('progressbar')).toHaveLength(2)
    await expect(canvas.getByText('Overage 1.5 hours')).toBeVisible()
    await expect(canvas.getAllByText(/days? left|Last day/)).toHaveLength(2)
  },
}

export const EngagementsDark: Story = { ...Engagements, parameters: { dark: true } }

export const EngagementUsedAndRemaining: Story = {
  parameters: engagements([retainer]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Support retainer')).toBeVisible()
    await expect(canvas.getByRole('progressbar')).toHaveAccessibleName('4 of 10 hours used')
    await expect(canvas.getByText('40%')).toBeVisible()
    await expect(canvas.getByText('Remaining 6 hours')).toBeVisible()
    await expect(canvas.queryByText(/Overage/)).toBeNull()
  },
}

export const EngagementOverage: Story = {
  parameters: engagements([
    {
      ...retainer,
      current_period: { ...retainer?.current_period, used: '12', remaining: '0', overage: '2' },
    },
  ]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Overage 2 hours')).toBeVisible()
    await expect(canvas.getByRole('progressbar')).toHaveAccessibleName('12 of 10 hours used')
    await expect(canvasElement.querySelector('[data-part=overage]')).not.toBeNull()
  },
}

export const EngagementWithoutPeriod: Story = {
  parameters: engagements([{ ...retainer, recurrence: 'none', current_period: null }]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('No period is running right now.')).toBeVisible()
    await expect(canvas.getByText('10 hours in total')).toBeVisible()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
  },
}

/** One engagement whose history answers with response. */
const withHistory = (response: Parameters<typeof http.get>[1]) => ({
  msw: {
    handlers: [
      http.get(`${P}/engagements`, () => HttpResponse.json({ data: [retainer] })),
      http.get(`${P}/engagements/:id/entries`, response),
      ...portalHandlers,
    ],
  },
})
const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}
const openActivity = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement)
  const details = await canvas.findByRole('button', { name: 'Details' })
  await userEvent.click(details)
  // The baseline shows the opened list at rest, without the click's hover tint or focus ring.
  await userEvent.unhover(details)
  details.blur()
  return canvas
}

/**
 * Details opens the activity inside the card: newest first, a light divider per period, each row with date,
 * quantity, note and the client performance only where the supplier wrote one. Details again closes it.
 */
export const EngagementActivity: Story = {
  parameters: withHistory(() => HttpResponse.json({ data: portalEngagementHistory })),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const details = await canvas.findByRole('button', { name: 'Details' })
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('region')).toBeNull()

    // A click anywhere on the summary opens it, not only on the button: the button covers the summary.
    const text = canvas.getByText('10 hours per month').getBoundingClientRect()
    const hit = document.elementFromPoint(text.left + 4, text.top + text.height / 2)
    await expect(hit).toBe(details)
    await userEvent.click(details)
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    const region = await canvas.findByRole('region', { name: 'Support retainer' })
    await expect(details).toHaveAttribute('aria-controls', region.id)
    const periods = await within(region).findAllByRole('heading', { level: 3 }) // the history loads after the region opens
    await expect(periods.map((h) => h.textContent)).toEqual([
      '1 Nov 2026 – 30 Nov 2026',
      '1 Oct 2026 – 31 Oct 2026',
    ])
    const rows = await within(region).findAllByRole('listitem')
    await expect(rows).toHaveLength(4)
    await expect(rows[0]).toHaveTextContent('18 Nov 2026')
    await expect(rows[0]).toHaveTextContent('1.5 hours')
    await expect(rows[0]).toHaveTextContent('Server updates and backup check')
    await expect(rows[0]).toHaveTextContent(
      'Client performance: Quick answers, access ready on time',
    )
    // Not shared for this delivery: no label, no empty box.
    await expect(rows[1]).toHaveTextContent('Mailbox migration')
    await expect(rows[1]).not.toHaveTextContent('Client performance')
    await expect(within(region).getAllByText('Client performance:')).toHaveLength(2)

    await userEvent.click(details)
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('region')).toBeNull()
    await userEvent.click(details)
    await canvas.findByRole('region', { name: 'Support retainer' })
  },
}

export const EngagementActivityDark: Story = {
  ...EngagementActivity,
  parameters: { ...EngagementActivity.parameters, dark: true },
}

/** Each card opens on its own: both can be open at once, and closing one leaves the other open. */
export const EngagementsSeveralOpen: Story = {
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Support retainer')
    const [first, second] = canvas.getAllByRole('button', { name: 'Details' })
    if (!first || !second) throw new Error('Two engagements expected')
    await userEvent.click(first)
    await userEvent.click(second)
    await waitFor(() => expect(canvas.getAllByRole('region')).toHaveLength(2))
    await userEvent.click(first)
    await expect(first).toHaveAttribute('aria-expanded', 'false')
    await expect(second).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getAllByRole('region')).toHaveLength(1)
  },
}

/** Each engagement takes the whole width of the page, one below the other. */
export const EngagementsFullWidth: Story = {
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Support retainer')
    const [a, b] = canvas.getAllByRole('listitem').map((li) => li.getBoundingClientRect())
    await expect(a?.width).toBe(b?.width)
    await expect(a?.left).toBe(b?.left)
    await expect(b?.top ?? 0).toBeGreaterThan(a?.bottom ?? 0)
  },
}

const long = 'Long session covering the yearly closing, '.repeat(8).trim()
/** A long note and client performance wrap inside the card and never push the page sideways on a phone. */
export const EngagementActivityLongTextPhone: Story = {
  parameters: {
    ...phone,
    ...withHistory(() =>
      HttpResponse.json({
        data: [
          {
            starts_on: '2026-11-01',
            ends_on: '2026-11-30',
            entries: [
              {
                id: 'ent_l',
                date: '2026-11-18',
                quantity: '12.25',
                note: long,
                client_performance: long,
              },
            ],
          },
        ],
      }),
    ),
  },
  globals: { viewport: { value: 'phone' } },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = await openActivity(canvasElement)
    await expect(await canvas.findByText('12.25 hours')).toBeVisible()
    await expect(canvas.getByText('Client performance:')).toBeVisible()
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

export const EngagementActivityEmpty: Story = {
  parameters: withHistory(() => HttpResponse.json({ data: [] })),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = await openActivity(canvasElement)
    await expect(await canvas.findByText('Nothing logged yet.')).toBeVisible()
    await expect(canvas.getByRole('region').querySelector('ol')).toBeNull()
  },
}

let activityCalls = 0
/** The activity failing to load says so inside the card; Try again asks once more and shows it. */
export const EngagementActivityError: Story = {
  parameters: withHistory(() =>
    ++activityCalls === 1
      ? HttpResponse.json({}, { status: 500 })
      : HttpResponse.json({ data: portalEngagementHistory }),
  ),
  beforeEach: () => {
    activityCalls = 0
  },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = await openActivity(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The history couldn’t be loaded',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(await canvas.findByText('Mailbox migration')).toBeVisible()
  },
}

export const EngagementsEmpty: Story = {
  parameters: engagements([]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('No active engagements')).toBeVisible()
  },
}

export const EngagementsError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/engagements`, () => HttpResponse.json({}, { status: 500 })),
        ...portalHandlers,
      ],
    },
  },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toBeVisible()
    await userEvent.hover(canvas.getByRole('button', { name: 'Try again' }))
  },
}

export const EngagementsLoading: Story = {
  parameters: {
    msw: {
      handlers: [http.get(`${P}/engagements`, () => new Promise(() => {})), ...portalHandlers],
    },
  },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getAllByRole('status', { name: 'Loading' })[0]).toBeVisible(),
    )
  },
}

export const Documents: Story = {
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Contract.pdf')).toBeVisible()
    await expect(canvas.getByText(/Shared 2 days ago/)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Download Contract.pdf' })).toHaveAttribute(
      'href',
      '/api/v1/public/portal/documents/doc_1/download',
    )
    // Four documents: no search box yet.
    await expect(canvas.queryByRole('searchbox')).toBeNull()
  },
}

export const DocumentsDark: Story = { ...Documents, parameters: { dark: true } }

/** From seven documents on, a search box filters them by name. */
export const DocumentsSearch: Story = {
  parameters: documents(() =>
    HttpResponse.json({
      data: [
        ...portalDocuments,
        ...portalDocuments
          .slice(0, 3)
          .map((doc, n) =>
            Object.assign({}, doc, { id: `doc_x${n}`, name: `Archive ${n + 1} ${doc.name}` }),
          ),
      ],
    }),
  ),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const search = await canvas.findByRole('searchbox', { name: 'Search documents' })
    await userEvent.type(search, 'archive')
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3)
    await userEvent.clear(search)
    await userEvent.type(search, 'nothing like this')
    await expect(canvas.getByText('No matching documents')).toBeVisible()
  },
}

export const DocumentsEmpty: Story = {
  parameters: documents(() => HttpResponse.json({ data: [] })),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('Nothing has been shared with you yet'),
    ).toBeVisible()
  },
}

export const DocumentsError: Story = {
  parameters: documents(() => HttpResponse.json({}, { status: 500 })),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    const alert = await within(canvasElement).findByRole('alert')
    await expect(within(alert).getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

export const DocumentsLoading: Story = {
  parameters: documents(() => new Promise(() => {})),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getAllByRole('status', { name: 'Loading' })[0]).toBeVisible(),
    )
  },
}

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
const openHistory = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement)
  await userEvent.click(await canvas.findByText('History'))
  // The baseline shows the opened list at rest, without the click's focus ring.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  return canvas
}

/** The history opens to every logged delivery, by period and newest first, with note and performance. */
export const EngagementHistory: Story = {
  parameters: withHistory(() => HttpResponse.json({ data: portalEngagementHistory })),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = await openHistory(canvasElement)
    const periods = canvas.getAllByRole('heading', { level: 3 })
    await expect(periods.map((h) => h.textContent)).toEqual([
      '1 Nov 2026 – 30 Nov 2026',
      '1 Oct 2026 – 31 Oct 2026',
    ])
    const rows = [...canvasElement.querySelectorAll('ol > li')]
    await expect(rows).toHaveLength(4)
    await expect(rows[0]).toHaveTextContent('Server updates and backup check')
    await expect(rows[0]).toHaveTextContent('Performance: Quick answers, access ready on time')
    await expect(rows[0]).toHaveTextContent('1.5 hours')
    await expect(canvas.getByText('Mailbox migration')).toBeVisible()
  },
}

export const EngagementHistoryDark: Story = {
  ...EngagementHistory,
  parameters: { ...EngagementHistory.parameters, dark: true },
}

const long = 'Long session covering the yearly closing, '.repeat(8).trim()
/** A long note and performance wrap inside the card and never push the page sideways on a phone. */
export const EngagementHistoryLongTextPhone: Story = {
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
    const canvas = await openHistory(canvasElement)
    await expect(canvas.getByText('12.25 hours')).toBeVisible()
    await expect(canvas.getByText(`Performance:`)).toBeVisible()
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

export const EngagementHistoryEmpty: Story = {
  parameters: withHistory(() => HttpResponse.json({ data: [] })),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Nothing logged yet.')).toBeVisible()
    await expect(canvas.queryByText('History')).toBeNull()
  },
}

export const EngagementHistoryError: Story = {
  parameters: withHistory(() => HttpResponse.json({}, { status: 500 })),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The history couldn’t be loaded',
    )
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

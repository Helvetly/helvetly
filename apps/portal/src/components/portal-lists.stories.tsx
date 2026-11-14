import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalDocuments, portalEngagements, portalHandlers } from '@/mocks/portal'

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

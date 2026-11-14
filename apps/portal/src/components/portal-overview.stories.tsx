import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalHandlers, portalInvoices } from '@/mocks/portal'

import { PortalOverview } from './portal-overview'

const P = '/api/v1/public/portal'
const meta = {
  title: 'Portal/Overview',
  component: PortalOverview,
  parameters: { msw: { handlers: portalHandlers } },
} satisfies Meta<typeof PortalOverview>
export default meta
type Story = StoryObj<typeof meta>

const year = new Date().getFullYear()

/** Greeting, the open total with its overdue part, the three invoices to act on, usage and files. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', {
        level: 1,
        name: /^Good (morning|afternoon|evening), Keller AG$/,
      }),
    ).toBeVisible()
    await expect(
      canvas.getByText('Muster GmbH shares your invoices, work and documents here.'),
    ).toBeVisible()
    await expect(await canvas.findByText('CHF 4’800.00')).toBeVisible()
    await expect(canvas.getByText(/1 invoice is overdue/)).toHaveTextContent('CHF 860.00')
    await expect(canvas.getByText(/3 open invoices/)).toHaveTextContent('next due in 5 days')

    const attention = canvas.getByRole('region', { name: 'Needs your attention' })
    const rows = within(attention).getAllByRole('listitem')
    await expect(rows.map((row) => row.textContent?.slice(0, 8))).toEqual([
      `${year}-009`,
      `${year}-012`,
      `${year}-014`,
    ])
    await expect(within(attention).getByText('12 days overdue')).toBeVisible()
    await expect(within(attention).getByText('Due in 5 days')).toBeVisible()
    await expect(
      within(attention).getByRole('link', { name: `Download PDF of invoice ${year}-009` }),
    ).toHaveAttribute('href', `${P}/invoices/inv_3/pdf`)

    const engagements = canvas.getByRole('region', { name: 'Engagements' })
    await expect(await within(engagements).findByText('40% used')).toBeVisible()
    await expect(within(engagements).getByText('125% used')).toBeVisible()

    const documents = canvas.getByRole('region', { name: 'Recently shared' })
    await expect(await within(documents).findByText('Contract.pdf')).toBeVisible()
    await expect(within(documents).getByText(/Shared 2 days ago/)).toBeVisible()
    await expect(within(documents).getAllByRole('listitem')).toHaveLength(3)
  },
}

export const FilledDark: Story = { ...Filled, parameters: { ...Filled.parameters, dark: true } }

/** Each currency is its own exact total. */
export const SeveralCurrencies: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/invoices`, () =>
          HttpResponse.json({
            data: [
              ...portalInvoices,
              { ...portalInvoices[0], id: 'inv_9', currency: 'EUR', amount_due: '50.50' },
            ],
          }),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('CHF 4’800.00')).toBeVisible()
    await expect(canvas.getByText('EUR 50.50')).toBeVisible()
  },
}

/** Nothing due, no engagements, no files: one friendly message, no empty sections. */
export const AllClear: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/invoices`, () => HttpResponse.json({ data: [] })),
        http.get(`${P}/engagements`, () => HttpResponse.json({ data: [] })),
        http.get(`${P}/documents`, () => HttpResponse.json({ data: [] })),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('You’re all set — nothing is due')).toBeVisible()
    await waitFor(() =>
      expect(canvas.queryByRole('region', { name: 'Recently shared' })).toBeNull(),
    )
    await expect(canvas.queryByRole('region', { name: 'Needs your attention' })).toBeNull()
    await expect(canvas.queryByRole('region', { name: 'Engagements' })).toBeNull()
  },
}

export const AllClearDark: Story = {
  ...AllClear,
  parameters: { ...AllClear.parameters, dark: true },
}

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/invoices`, () => new Promise(() => {})),
        http.get(`${P}/documents`, () => new Promise(() => {})),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getAllByRole('status', { name: 'Loading' })[0]).toBeVisible(),
    )
  },
}

/** A failed section says so in place and retries on its own; the rest still shows. */
export const SectionError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/documents`, () => HttpResponse.json({}, { status: 500 })),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const documents = await canvas.findByRole('region', { name: 'Recently shared' })
    await expect(await within(documents).findByRole('alert')).toHaveTextContent(
      'Documents couldn’t be loaded',
    )
    await userEvent.hover(within(documents).getByRole('button', { name: 'Try again' }))
    await expect(await canvas.findByText('CHF 4’800.00')).toBeVisible()
  },
}

export const InvoicesError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/invoices`, () => HttpResponse.json({}, { status: 500 })),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const due = await within(canvasElement).findByRole('region', { name: 'Amount due' })
    await expect(await within(due).findByRole('alert')).toHaveTextContent(
      'Your invoices couldn’t be loaded',
    )
  },
}

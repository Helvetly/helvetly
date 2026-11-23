import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalEngagements, portalHandlers, portalInvoices, portalSession } from '@/mocks/portal'
import { schedulingHandlers } from '@/mocks/scheduling'

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
const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}

/** Key numbers on top, then one row per thing to do (overdue first), new files beside it. */
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

    const tiles = within(await canvas.findByLabelText('Summary'))
    await expect(tiles.getByText('CHF 4’800.00')).toBeVisible()
    await expect(tiles.getByText('CHF 860.00')).toBeVisible()
    // Usage: the engagement closest to its limit, named and linked to its row, with how many more are active.
    await expect(await tiles.findByText('125% used')).toBeVisible()
    await expect(tiles.getByRole('link', { name: 'Website maintenance' })).toHaveAttribute(
      'href',
      '/engagements/#eng_2',
    )
    await expect(tiles.getByText('7.5 of 6 hours used', { exact: false })).toBeVisible()
    await expect(tiles.getByText('Active')).toBeVisible()
    await expect(tiles.getByRole('progressbar')).toHaveAccessibleName('7.5 of 6 hours used')
    await expect(tiles.getByRole('link', { name: '+1 more' })).toHaveAttribute(
      'href',
      '/engagements/',
    )
    // Every tile the same height.
    const heights = [...canvasElement.querySelectorAll('dl[aria-label="Summary"] > div')].map(
      (tile) => Math.round(tile.getBoundingClientRect().height),
    )
    await expect(heights).toHaveLength(3)
    await expect(new Set(heights).size).toBe(1)

    const attention = canvas.getByRole('region', { name: 'Needs your attention' })
    const groups = within(attention)
      .getAllByRole('list')
      .map((group) => group.getAttribute('aria-labelledby'))
    await expect(groups).toEqual(['attention-overdue', 'attention-week', 'attention-later'])
    const overdue = within(attention).getByRole('list', { name: 'Overdue' })
    await expect(within(overdue).getByText(`Invoice ${year}-009`)).toBeVisible()
    await expect(within(overdue).getByText(/12 days overdue/)).toBeVisible()
    const week = within(attention).getByRole('list', { name: 'This week' })
    await expect(within(week).getByText(`Invoice ${year}-012`)).toBeVisible()
    // Later, soonest first: the quote valid 9 more days, the invoice due in 25, the quote valid 27.
    const later = within(attention).getByRole('list', { name: 'Later' })
    await expect(
      within(later)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('.font-medium')?.textContent),
    ).toEqual([`Quote Q-${year}-002 · Rev. 2`, `Invoice ${year}-014`, `Quote Q-${year}-001`])
    await expect(within(attention).getByRole('link', { name: 'All invoices' })).toHaveAttribute(
      'href',
      '/invoices/',
    )
    await expect(
      within(attention).getByRole('link', { name: `Download PDF of invoice ${year}-009` }),
    ).toHaveAttribute('href', `${P}/invoices/inv_3/pdf`)

    // No engagements panel beside the to-do list: the usage tile and the Engagements page say it once.
    await expect(canvas.queryByRole('region', { name: 'Engagements' })).toBeNull()
    const documents = canvas.getByRole('region', { name: 'Recently shared' })
    await expect(await within(documents).findByText('Contract.pdf')).toBeVisible()
    await expect(within(documents).getAllByRole('listitem')).toHaveLength(3)
  },
}

export const FilledDark: Story = { ...Filled, parameters: { ...Filled.parameters, dark: true } }

/** Pay opens how to pay in place: the amount, the due date and the PDF with its QR bill. */
export const PayInPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: `Pay invoice ${year}-009` }))
    const dialog = await within(document.body).findByRole('dialog', {
      name: `Pay invoice ${year}-009`,
    })
    await expect(await within(dialog).findByText(/scan the QR code/)).toBeVisible()
    await expect(within(dialog).getByText('CHF 860.00')).toBeVisible()
    await expect(within(dialog).getByText(/12 days overdue/)).toBeVisible()
    await expect(within(dialog).getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'href',
      `${P}/invoices/inv_3/pdf`,
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  },
}

export const PayPartialBalance: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: `Pay invoice ${year}-012` }))
    const dialog = await within(document.body).findByRole('dialog', {
      name: `Pay invoice ${year}-012`,
    })
    await expect(
      await within(dialog).findByText(/Use the current amount due shown here/),
    ).toBeVisible()
    await expect(within(dialog).getByText('CHF 700.00')).toBeVisible()
    await expect(within(dialog).queryByText(/scan the QR code/)).toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  },
}

export const PayBalanceUnavailable: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/invoices`, () => HttpResponse.json({ data: portalInvoices }), {
          once: true,
        }),
        http.get(`${P}/invoices`, () => new HttpResponse(null, { status: 503 })),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: `Pay invoice ${year}-009` }))
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: `Pay invoice ${year}-009` }),
    )
    await expect(await dialog.findByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(dialog.queryByText('CHF 860.00')).toBeNull()
    await expect(dialog.queryByRole('link', { name: 'Download PDF' })).toBeNull()
  },
}

/** Accept answers a quote in place; once accepted it leaves the list. */
export const AcceptInPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: `Accept quote Q-${year}-001` }))
    const dialog = await within(document.body).findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /Accept quote/ }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    const attention = canvas.getByRole('region', { name: 'Needs your attention' })
    await waitFor(() => expect(within(attention).queryByText(`Quote Q-${year}-001`)).toBeNull())
  },
}

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
    const tiles = within(await within(canvasElement).findByLabelText('Summary'))
    await expect(tiles.getByText('CHF 4’800.00')).toBeVisible()
    await expect(tiles.getByText('EUR 50.50')).toBeVisible()
  },
}

/** Nothing due, nothing to answer, no engagements, no files: a calm "all set" and no empty sections. */
export const AllClear: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/invoices`, () => HttpResponse.json({ data: [] })),
        http.get(`${P}/quotes`, () => HttpResponse.json({ data: [] })),
        http.get(`${P}/engagements`, () => HttpResponse.json({ data: [] })),
        http.get(`${P}/documents`, () => HttpResponse.json({ data: [] })),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('You’re all set')).toBeVisible()
    await expect(canvas.getByText('Nothing due')).toBeVisible()
    await expect(canvas.getByText('Everything is on time')).toBeVisible()
    await waitFor(() =>
      expect(canvas.queryByRole('region', { name: 'Recently shared' })).toBeNull(),
    )
    await expect(canvas.queryByRole('region', { name: 'Engagements' })).toBeNull()
    // The to-do list takes the whole width: no side column leaving a hole.
    const attention = canvas.getByRole('region', { name: 'Needs your attention' })
    await expect(attention.getBoundingClientRect().width).toBe(
      attention.parentElement?.getBoundingClientRect().width,
    )
  },
}

export const AllClearDark: Story = {
  ...AllClear,
  parameters: { ...AllClear.parameters, dark: true },
}

/** No engagements: the usage tile and card are gone, two tiles fill the strip. */
export const NoEngagements: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/engagements`, () => HttpResponse.json({ data: [] })),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Amount due')).toBeVisible()
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('dl[aria-label="Summary"] > div')).toHaveLength(2),
    )
    await expect(canvas.queryByText('Engagement usage')).toBeNull()
    await expect(canvas.queryByRole('region', { name: 'Engagements' })).toBeNull()
    await expect(await canvas.findByRole('region', { name: 'Recently shared' })).toBeVisible()
  },
}

/** One active engagement: no "+N more"; a past one never fills the usage tile. */
export const OneEngagement: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/engagements`, () =>
          HttpResponse.json({
            data: portalEngagements.filter((e) => e.id !== 'eng_2'),
          }),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const tiles = within(await within(canvasElement).findByLabelText('Summary'))
    await expect(await tiles.findByText('40% used')).toBeVisible()
    await expect(tiles.getByRole('link', { name: 'Support retainer' })).toHaveAttribute(
      'href',
      '/engagements/#eng_1',
    )
    await expect(tiles.getByText(/4 of 10 hours used · \d+ days? left|Last day/)).toBeVisible()
    await expect(tiles.queryByRole('link', { name: /more/ })).toBeNull()
  },
}

/** Only past engagements: no usage tile, as with none. */
export const OnlyPastEngagements: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/engagements`, () =>
          HttpResponse.json({ data: portalEngagements.filter((e) => e.status !== 'active') }),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Amount due')).toBeVisible()
    await waitFor(() => expect(canvas.queryByText('Engagement usage')).toBeNull())
  },
}

const longSupplier =
  'John Doe John Doe John Doe John Doe Consulting und Treuhand GmbH with a very long registered name'

/** A 100-character legal name is cut in the greeting's subtitle; the full one is its tooltip. */
export const LongCompanyName: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/session`, () =>
          HttpResponse.json({
            ...portalSession,
            client: { id: 'cli_1', name: 'Keller Beratung und Treuhand AG mit einem langen Namen' },
            workspace: { name: longSupplier },
          }),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const subtitle = await canvas.findByTitle(longSupplier)
    await expect(subtitle).toHaveTextContent(
      'John Doe John Doe John Doe John Doe Cons… shares your invoices, work and documents here.',
    )
    const heading = canvas.getByRole('heading', { level: 1 })
    await expect(heading).toHaveTextContent(/Keller Beratung und Treuhand AG mit eine…$/)
  },
}

/** A phone: one column in priority order (numbers, to-dos, files), nothing wider than the screen. */
export const Phone: Story = {
  parameters: phone,
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const documents = await canvas.findByRole('region', { name: 'Recently shared' })
    const attention = canvas.getByRole('region', { name: 'Needs your attention' })
    const summary = await canvas.findByLabelText('Summary')
    await expect(summary.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      attention.getBoundingClientRect().top,
    )
    await expect(attention.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      documents.getBoundingClientRect().top,
    )
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

const withSessions = { msw: { handlers: [...schedulingHandlers, ...portalHandlers] } }

/**
 * With Scheduling: the next session (within 7 days) and a free cancellation ending within 24 h join the to-do list
 * under Today, each with one action, and the side column shows the next session in full.
 */
export const WithSessions: Story = {
  parameters: withSessions,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const attention = canvas.getByRole('region', { name: 'Needs your attention' })
    // Both are hours away: Today, or This week late in the evening.
    const next = await waitFor(() => {
      const row = attention.querySelector<HTMLElement>('[data-attention="soc_soon"]')
      if (!row) throw new Error('no next-session row yet')
      return row
    })
    await expect(within(next).getByText('Strategy call')).toBeVisible()
    await expect(
      within(next).getByText(/^(Today|Tomorrow), \d\d:\d\d–\d\d:\d\d · Zurich$/),
    ).toBeVisible()
    await expect(within(next).getAllByRole('link')).toHaveLength(1)
    await expect(within(next).getByRole('link', { name: 'Join' })).toBeVisible()
    const closing = attention.querySelector<HTMLElement>('[data-attention="soc_german_5"]')!
    await expect(
      within(closing).getByText(/^Free cancellation ends (Today|Tomorrow), /),
    ).toBeVisible()
    await expect(within(closing).getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/sessions/',
    )
    // Groups in order of urgency.
    const groups = within(attention)
      .getAllByRole('list')
      .map((group) => group.getAttribute('aria-labelledby'))
    await expect(groups[0]).toBe('attention-overdue')
    await expect(groups.at(-1)).toBe('attention-later')

    const card = canvas.getByRole('region', { name: 'Next session' })
    await expect(within(card).getByText('Strategy call')).toBeVisible()
    await expect(within(card).getByRole('link', { name: /^Add to calendar: / })).toBeVisible()
    await expect(within(card).getByRole('link', { name: 'All sessions' })).toHaveAttribute(
      'href',
      '/sessions/',
    )
    // Wide screens: the to-do list on the left, the next session on the right.
    await expect(card.getBoundingClientRect().left).toBeGreaterThan(
      attention.getBoundingClientRect().right,
    )
  },
}

/** A phone with sessions: numbers, to-dos, the next session and files in one column, nothing wider than the screen. */
export const PhoneWithSessions: Story = {
  parameters: { ...phone, ...withSessions },
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = await canvas.findByRole('region', { name: 'Next session' })
    const attention = canvas.getByRole('region', { name: 'Needs your attention' })
    const documents = await canvas.findByRole('region', { name: 'Recently shared' })
    await expect(attention.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      card.getBoundingClientRect().top,
    )
    await expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      documents.getBoundingClientRect().top,
    )
    const tiles = [...canvasElement.querySelectorAll('dl[aria-label="Summary"] > div')]
    await expect(tiles[0]!.getBoundingClientRect().height).toBe(
      tiles[1]!.getBoundingClientRect().height,
    )
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
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

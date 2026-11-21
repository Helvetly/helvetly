import { formatDate } from '@helvetly/ui/lib/format'
import { setCsrfToken } from '@helvetly/ui/lib/http'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { civilToday } from '@/lib/dates'
import { portalHandlers, portalQuotes, portalSession } from '@/mocks/portal'

import { PortalQuotes } from './portal-quotes'

const url = '/api/v1/public/portal/quotes'
const meta = {
  title: 'Portal/Quotes',
  component: PortalQuotes,
  beforeEach: () => setCsrfToken(portalSession.csrf_token),
  parameters: {
    msw: { handlers: portalHandlers },
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
} satisfies Meta<typeof PortalQuotes>
export default meta
type Story = StoryObj<typeof meta>

const withQuotes = (handler: Parameters<typeof http.get>[1]) => ({
  ...meta.parameters,
  msw: { handlers: [http.get(url, handler), ...portalHandlers] },
})
const year = new Date().getFullYear()
const first = `Q-${year}-001`
const today = formatDate(civilToday())
const body = () => within(document.body)

/** Every state: awaiting (with a revision), accepted with the client's note, and expired. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(first)).toBeVisible()
    await expect(canvas.getByText(`Q-${year}-002 · Rev. 2`)).toBeVisible()
    await expect(canvas.getAllByText('Awaiting your answer')).toHaveLength(2)
    await expect(canvas.getByText('Expired – ask for a new quote')).toBeVisible()
    await expect(
      canvas.getByText('Your note: “Please start in the first week of the month.”'),
    ).toBeVisible()
    await expect(canvas.getByText('CHF 1’234.50')).toBeVisible()
    // Only quotes still awaiting an answer can be accepted or declined.
    await expect(canvas.getAllByRole('button', { name: /^Accept quote/ })).toHaveLength(2)
    await expect(canvas.getAllByRole('button', { name: /^Decline quote/ })).toHaveLength(2)
    await expect(
      canvas.getByRole('link', { name: `Download PDF of quote ${first}` }),
    ).toHaveAttribute('href', `${url}/quo_1/pdf`)
  },
}

/** A quote with a payment schedule lists its due dates and amounts, which the client accepts with it. */
export const WithSchedule: Story = {
  parameters: withQuotes(() =>
    HttpResponse.json({
      data: [
        {
          ...portalQuotes[0],
          total: '3000.00',
          instalments: [
            { seq: 1, due_date: '2026-12-01', amount: '1000.00' },
            { seq: 2, due_date: '2027-01-01', amount: '2000.00' },
          ],
        },
      ],
    }),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const schedule = await canvas.findByRole('region', { name: 'Payment schedule' })
    const rows = within(schedule).getAllByRole('listitem')
    await expect(rows).toHaveLength(2)
    await expect(rows[0]).toHaveTextContent(`${formatDate('2026-12-01')}CHF 1’000.00`)
    await expect(rows[1]).toHaveTextContent(`${formatDate('2027-01-01')}CHF 2’000.00`)
    await userEvent.click(canvas.getByRole('button', { name: /^Accept quote/ }))
    await expect(await body().findByRole('dialog', { name: /CHF 3’000.00/ })).toBeVisible()
  },
}

export const WithSchedulePhone: Story = {
  ...WithSchedule,
  globals: { viewport: { value: 'phone' } },
}

export const FilledDark: Story = { ...Filled, parameters: { ...meta.parameters, dark: true } }

/** A 390px phone: nothing pushes the page sideways and the buttons stay on one row. */
export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const accept = await canvas.findByRole('button', { name: `Accept quote ${first}` })
    await expect(window.innerWidth).toBe(390)
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
    const decline = canvas.getByRole('button', { name: `Decline quote ${first}` })
    await expect(accept.getBoundingClientRect().top).toBe(decline.getBoundingClientRect().top)
  },
}
export const PhoneDark: Story = { ...Phone, parameters: { ...meta.parameters, dark: true } }

export const Loading: Story = {
  parameters: withQuotes(async () => {
    await delay('infinite')
    return HttpResponse.json({ data: [] })
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByRole('status', { name: 'Loading quotes' })).toBeVisible(),
    )
  },
}

export const Empty: Story = {
  parameters: withQuotes(() => HttpResponse.json({ data: [] })),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('No quotes yet')).toBeVisible()
  },
}

export const ErrorState: Story = {
  parameters: withQuotes(() =>
    HttpResponse.json({ error: { code: 'internal', message: 'Server is down.' } }, { status: 500 }),
  ),
  play: async ({ canvasElement }) => {
    const alert = await within(canvasElement).findByRole('alert', {}, { timeout: 10000 })
    await expect(alert).toHaveTextContent('Your quotes couldn’t be loaded')
    await expect(within(alert).getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

/** Accept with a note: the button shows the pending state, then the row shows the answer. */
export const AcceptWithNote: Story = {
  parameters: {
    ...meta.parameters,
    msw: {
      handlers: [
        http.post(`${url}/:id/accept`, async ({ request }) => {
          await delay(400)
          const sent: unknown = await request.json()
          return HttpResponse.json({
            data: {
              ...portalQuotes[0],
              status: 'accepted',
              decided_at: new Date().toISOString(),
              decision_note:
                typeof sent === 'object' && sent !== null && 'note' in sent ? sent.note : null,
            },
          })
        }),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: `Accept quote ${first}` }))
    const dialog = body().getByRole('dialog', {
      name: `Accept quote ${first} for CHF 1’234.50?`,
    })
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Please start on 1 December.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept quote' }))
    await expect(await within(dialog).findByRole('button', { name: 'Accepting…' })).toBeDisabled()
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
    await expect(canvas.getByText(`Accepted on ${today}`)).toBeVisible()
    await expect(canvas.getByText('Your note: “Please start on 1 December.”')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: `Accept quote ${first}` })).toBeNull()
  },
}

/** Decline without a note; Cancel first leaves everything as it was. */
export const Decline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const decline = await canvas.findByRole('button', { name: `Decline quote ${first}` })
    await userEvent.click(decline)
    await userEvent.click(body().getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())

    await userEvent.click(decline)
    const dialog = body().getByRole('dialog', { name: `Decline quote ${first}?` })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline quote' }))
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
    await expect(canvas.getByText(`Declined on ${today}`)).toBeVisible()
    await expect(canvas.getByText('Declined')).toBeVisible()
  },
}

/** The quote expired meanwhile: the API's 409 message shows in the dialog, which stays open. */
export const ExpiredConflict: Story = {
  parameters: {
    ...meta.parameters,
    msw: {
      handlers: [
        http.post(`${url}/:id/accept`, () =>
          HttpResponse.json(
            { error: { code: 'invalid_state', message: 'This quote has expired.' } },
            { status: 409 },
          ),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: `Accept quote ${first}` }))
    const dialog = body().getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept quote' }))
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This quote has expired.',
    )
    await expect(within(dialog).getByRole('button', { name: 'Accept quote' })).toBeEnabled()
  },
}

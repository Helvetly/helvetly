import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import { NumberSuggestion } from '@/components/onboarding/number-suggestion'
import type { NumberSuggestion as Offer } from '@/lib/invoices'
import { sampleSettings } from '@/test/invoice-api'

const session = {
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role: 'owner',
  scopes: ['*:*'],
  onboarded: false,
  csrf_token: 'storybook-only',
}

const offer: Offer = { format: 'FV/{N}/{MM}/{YYYY}', year: 2026, last: 17, next: 'FV/18/11/2026' }

const handlers = (applied: Parameters<typeof http.post>[1]) => [
  http.get('/api/v1/session', () => HttpResponse.json(session)),
  http.get('/api/v1/invoice-settings/number-suggestion', () => HttpResponse.json({ data: offer })),
  http.post('/api/v1/invoice-settings/number-suggestion', applied),
]

const meta = {
  title: 'Onboarding/Number suggestion',
  parameters: {
    msw: {
      handlers: handlers(async () => {
        await delay(150)
        return HttpResponse.json({ data: sampleSettings({ number_format: offer.format }) })
      }),
    },
  },
  render: () => (
    <div className="max-w-xl p-6">
      <NumberSuggestion imported="12 invoices, 4 clients" onApplied={() => {}} />
    </div>
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** After an import into a new workspace: the numbering its invoices follow, taken over in one click. */
export const Offered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        'They follow FV/{N}/{MM}/{YYYY}. Your next invoice would be FV/18/11/2026.',
      ),
    ).toBeVisible()
    const use = canvas.getByRole('button', { name: 'Use this format' })
    await userEvent.click(use)
    await expect(use).toBeDisabled()
    await expect(await canvas.findByText('New invoices continue at FV/18/11/2026.')).toBeVisible()
  },
}

export const OfferedDark: Story = { ...Offered, parameters: { ...meta.parameters, dark: true } }

/** Keeping one's own format closes the offer; nothing is sent. */
export const Kept: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Keep my format' }))
    await expect(canvas.queryByText(/They follow/)).toBeNull()
  },
}

/** An invoice issued meanwhile: the takeover is refused, said why, and can be tried again. */
export const Refused: Story = {
  parameters: {
    msw: {
      handlers: handlers(() =>
        HttpResponse.json(
          {
            error: {
              code: 'no_number_suggestion',
              message:
                'The imported invoices suggest no other numbering, or an invoice was issued meanwhile.',
            },
          },
          { status: 409 },
        ),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Use this format' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      /an invoice was issued meanwhile/,
    )
    await expect(canvas.getByRole('button', { name: 'Use this format' })).toBeEnabled()
  },
}

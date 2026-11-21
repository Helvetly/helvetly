import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AIApprovalProvider } from '@/components/ai/ai-approval'
import { billingFixture, entitlementsFixture } from '@/components/billing/billing-fixture'
import { ExpenseForm } from '@/components/expenses/expense-form'
import { aiConsent, aiNotice } from '@/mocks/ai-notice'
import { sampleSettings } from '@/test/invoice-api'

import { dark, phone } from './pages/frame'
import { storySession } from './screen-fixtures'

const travel = {
  id: 'exc_travel',
  name: 'Travel',
  account_code: '6640',
  is_archived: false,
  expenses_count: 0,
}
const usage = (granted: boolean) =>
  HttpResponse.json({
    period: '2026-11',
    tokens_used: 0,
    tokens_included: 500_000,
    tokens_purchased: 0,
    tokens_remaining: 500_000,
    provider_available: true,
    consent: aiConsent(granted),
  })

/** A checked reading: Swisscom at 8.1%, its supplier read with low confidence and the category unsure. */
const reading = {
  supplier: { name: 'Swisscom (Schweiz) AG', vat_number: null, country: 'CH', iban: null },
  document: { type: 'invoice', number: 'R-12', date: '2026-11-03', due_date: null },
  description: 'Mobile subscription November',
  currency: 'CHF',
  totals: { net: '100.00', vat: '8.10', gross: '108.10' },
  vat_breakdown: [{ rate: '8.1', net: '100.00', vat: '8.10', gross: '108.10' }],
  items: [],
  payment: { status: 'unknown', method: null, paid_on: null },
  reverse_charge: false,
  category: { ...travel, confidence: 0.4, reason: null },
  confidence: {
    supplier: 'low',
    document: 'high',
    totals: 'high',
    vat_breakdown: 'high',
    items: 'high',
    payment: 'high',
  },
  issues: {},
}

const previews = fn()
const handlers = (preview: () => Response | Promise<Response>, granted = true) => [
  http.get('/api/v1/session', () => HttpResponse.json(storySession)),
  http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
  http.get('/api/v1/expense-categories', () => HttpResponse.json({ data: [travel] })),
  http.get('/api/v1/heidi/usage', () => usage(granted)),
  http.get('/api/v1/heidi/consent', () =>
    HttpResponse.json({ data: aiConsent(granted), notice: aiNotice }),
  ),
  http.post('/api/v1/expenses/preview', () =>
    HttpResponse.json(
      { error: { code: 'validation_failed', message: 'Complete the amount.' } },
      { status: 422 },
    ),
  ),
  http.post('/api/v1/expenses/receipt-preview', () => {
    previews()
    return preview()
  }),
]

const onImport = fn()
const meta = {
  title: 'Expenses/New expense',
  parameters: {
    layout: 'fullscreen',
    msw: { handlers: handlers(() => HttpResponse.json({ data: reading })) },
  },
  beforeEach: () => {
    previews.mockClear()
    onImport.mockClear()
  },
  render: () => (
    <AIApprovalProvider>
      <ExpenseForm start onClose={fn()} onSaved={fn()} onImport={onImport} />
    </AIApprovalProvider>
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The form's own sheet, once the loading sheet (which waits for the settings) has given way to it. */
const sheet = async () => {
  const body = within(document.body)
  await waitFor(() =>
    expect(body.getByRole('dialog').querySelector('[data-slot="loader"]')).toBeNull(),
  )
  return within(body.getByRole('dialog'))
}
const receipt = (name = 'swisscom.png') => new File(['png'], name, { type: 'image/png' })
const pick = async (...files: File[]) => {
  const view = await sheet()
  await userEvent.upload(await view.findByLabelText('Upload receipts'), files)
  return view
}

/** The receipt comes first, in the form's own sheet: Continue waits for a file, reading with AI is on. */
export const UploadStep: Story = {
  play: async () => {
    const view = await sheet()
    await expect(await view.findByText('Drop the receipt here')).toBeVisible()
    await expect(view.getByRole('switch', { name: /Read with AI/ })).toBeChecked()
    await expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await expect(view.queryByRole('textbox', { name: /Supplier$/ })).toBeNull()
    await pick(receipt())
    await expect(view.getByText('swisscom.png')).toBeVisible()
    await expect(view.getByRole('button', { name: 'Continue' })).toBeEnabled()
  },
}
export const UploadStepDark = dark(UploadStep)
/** On a phone (in Storybook and the visual suite) the sheet fills the screen and offers the camera. */
export const UploadStepPhone = phone(UploadStep)

/** "Enter manually" skips the receipt and the AI: the empty form, nothing sent. */
export const EnterManually: Story = {
  play: async () => {
    const view = await sheet()
    await userEvent.click(await view.findByRole('button', { name: 'Enter manually' }))
    await expect(await view.findByRole('textbox', { name: /Supplier$/ })).toHaveValue('')
    await expect(view.getByText('Drop the receipt here')).toBeVisible()
    await expect(previews).not.toHaveBeenCalled()
  },
}

/** While the AI reads, the same sheet waits with a way out to typing; stopping keeps the file. */
export const Reading: Story = {
  parameters: {
    msw: {
      handlers: handlers(async () => {
        await delay('infinite')
        return HttpResponse.json({})
      }),
    },
  },
  play: async () => {
    const view = await pick(receipt())
    await userEvent.click(view.getByRole('button', { name: 'Continue' }))
    await expect(await view.findByText('Reading the document…')).toBeVisible()
    await expect(view.getByText('Reading 1 file')).toBeVisible()
    await userEvent.click(view.getByRole('button', { name: 'Stop and enter manually' }))
    await expect(await view.findByRole('textbox', { name: /Supplier$/ })).toHaveValue('')
    await expect(view.getByText('swisscom.png')).toBeVisible()
  },
}
export const ReadingPhone = phone(Reading)

/**
 * The reading fills the form: marks beside what it filled, an amber one where it was unsure, the category with the
 * AI's confidence.
 */
export const LowConfidence: Story = {
  play: async () => {
    const view = await pick(receipt())
    await userEvent.click(view.getByRole('button', { name: 'Continue' }))
    const supplier = await view.findByRole('textbox', { name: /Supplier$/ })
    await waitFor(() => expect(supplier).toHaveValue('Swisscom (Schweiz) AG'))
    await expect(view.getByRole('textbox', { name: 'Line 1 amount' })).toHaveValue('108.10')
    await expect(view.getByText('Suggested by the AI · 40% sure')).toBeVisible()
    await expect(view.getByText(/^The AI was unsure, check: Supplier, .*Category\.$/)).toBeVisible()
    const field = supplier.closest('[data-slot="form-field"]')
    await expect(field?.querySelector('[data-ai-mark="unsure"]')).not.toBeNull()
    const reference = view.getByRole('textbox', { name: /receipt no/i })
    await expect(
      reference.closest('[data-slot="form-field"]')?.querySelector('[data-ai-mark="sure"]'),
    ).not.toBeNull()
    await expect(previews).toHaveBeenCalledOnce()
  },
}
export const LowConfidenceDark = dark(LowConfidence)

/** A file with no expense in it is a warning with the next step, not an error. */
export const ReadNothingFound: Story = {
  parameters: {
    msw: {
      handlers: handlers(() =>
        HttpResponse.json(
          { error: { code: 'no_receipt', message: 'No expense was found in this file.' } },
          { status: 422 },
        ),
      ),
    },
  },
  play: async () => {
    const view = await pick(receipt())
    await userEvent.click(view.getByRole('button', { name: 'Continue' }))
    const alert = await view.findByRole('alert')
    await expect(alert).toHaveAttribute('data-tone', 'warning')
    await expect(alert).toHaveTextContent('No expense found')
    await expect(alert).toHaveTextContent('enter the details yourself')
    await expect(alert).not.toHaveTextContent('No expense was found in this file.')
  },
}

/** A failed reading opens the form anyway, with the file staged and the reason under it. */
export const ReadFailed: Story = {
  parameters: {
    msw: {
      handlers: handlers(() =>
        HttpResponse.json(
          {
            error: {
              code: 'receipt_unreadable',
              message: 'The AI model’s answer could not be read.',
            },
          },
          { status: 502 },
        ),
      ),
    },
  },
  play: async () => {
    const view = await pick(receipt())
    await userEvent.click(view.getByRole('button', { name: 'Continue' }))
    const alert = await view.findByRole('alert')
    await expect(alert).toHaveAttribute('data-tone', 'danger')
    await expect(alert).toHaveTextContent('The file could not be read')
    await expect(alert).toHaveTextContent('The AI model’s answer could not be read.')
    await expect(view.getByRole('textbox', { name: /Supplier$/ })).toHaveValue('')
    await expect(view.getByText('swisscom.png')).toBeVisible()
    await expect(view.getByRole('button', { name: 'Read again with AI' })).toBeEnabled()
  },
}

/** Without the person's approval the first reading asks; "Not now" sends nothing and opens the form. */
export const NoConsent: Story = {
  parameters: {
    msw: { handlers: handlers(() => HttpResponse.json({ data: reading }), false) },
  },
  play: async () => {
    const view = await pick(receipt())
    await userEvent.click(view.getByRole('button', { name: 'Continue' }))
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'Not now' }))
    await expect(await body.findByText(/AI use isn’t approved in this workspace/)).toBeVisible()
    await expect(body.getByRole('textbox', { name: /Supplier$/ })).toHaveValue('')
    await expect(previews).not.toHaveBeenCalled()
  },
}

/** This month's automation allowance is used up: reading is off and says why; Continue opens the form. */
export const PoolUsedUp: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', () =>
          HttpResponse.json({
            data: billingFixture({
              plan: 'pro',
              locked: false,
              status: 'active',
              entitlements: entitlementsFixture('pro', {
                used: { ai_automation_tokens_per_month: 10_000_000 },
              }),
            }),
          }),
        ),
        ...handlers(() => HttpResponse.json({ data: reading })),
      ],
    },
  },
  play: async () => {
    const view = await pick(receipt())
    const ai = view.getByRole('switch', { name: /Read with AI/ })
    await waitFor(() => expect(ai).not.toBeChecked())
    await expect(view.getByText('This month’s AI automation allowance is used up.')).toBeVisible()
    await userEvent.click(view.getByRole('button', { name: 'Continue' }))
    await expect(await view.findByRole('textbox', { name: /Supplier$/ })).toHaveValue('')
    await expect(view.getByText('swisscom.png')).toBeVisible()
    await expect(previews).not.toHaveBeenCalled()
  },
}

/** Several files are one expense's pages by default; "One expense per file" hands them to the AI import. */
export const SeveralFiles: Story = {
  play: async () => {
    const view = await pick(receipt('page-1.png'), receipt('page-2.png'))
    await expect(view.getByRole('radio', { name: 'One expense' })).toBeChecked()
    await userEvent.click(view.getByRole('radio', { name: 'One expense per file' }))
    await userEvent.click(view.getByRole('button', { name: 'Import 2 files' }))
    await expect(onImport).toHaveBeenCalledOnce()
    await expect(onImport.mock.calls[0]?.[0]).toHaveLength(2)
    await expect(previews).not.toHaveBeenCalled()
  },
}

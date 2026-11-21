import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ExpenseForm } from '@/components/expenses/expense-form'
import type { ExpenseInput } from '@/lib/expenses'
import { sampleSettings } from '@/test/invoice-api'

import { expense } from './pages/api'

const session = {
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role: 'owner',
  scopes: ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
}
const category = (id: string, name: string, account_code: string) => ({
  id,
  name,
  account_code,
  is_archived: false,
  expenses_count: 0,
})
const saved = fn()
const handlers = [
  http.get('/api/v1/session', () => HttpResponse.json(session)),
  http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
  http.get('/api/v1/uid-register/search', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/expense-categories', () =>
    HttpResponse.json({
      data: [category('exc_office', 'Office', '6500'), category('exc_it', 'IT & software', '6570')],
    }),
  ),
  http.post('/api/v1/expenses/preview', () =>
    HttpResponse.json({ data: expense({ status: 'draft' }) }),
  ),
  http.post<never, ExpenseInput>('/api/v1/expenses', async ({ request }) => {
    const input = await request.json()
    saved(input)
    return HttpResponse.json(
      { data: expense({ id: 'exp_new', status: 'draft', entry_mode: input.entry_mode }) },
      { status: 201 },
    )
  }),
]

const meta = {
  title: 'Expenses/Amounts',
  parameters: { layout: 'fullscreen', msw: { handlers } },
  render: () => <ExpenseForm onClose={fn()} onSaved={fn()} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = within(document.body)
const itemise = async () => {
  await userEvent.click(await body.findByRole('radio', { name: 'Items' }))
  return body.findByRole('textbox', { name: 'Line 1 quantity' })
}

/** Items: quantity × price fills the amount, an item takes its own category, and the input carries both. */
export const Itemised: Story = {
  play: async () => {
    saved.mockClear()
    await userEvent.type(await itemise(), '2')
    await userEvent.type(body.getByRole('textbox', { name: 'Line 1 unit price' }), '54.05')
    await expect(body.getByRole('textbox', { name: 'Line 1 amount' })).toHaveValue('108.10')
    await userEvent.click(body.getByRole('button', { name: /^Line 1 category/ }))
    await userEvent.click(await body.findByRole('option', { name: /IT & software/ }))
    await userEvent.click(body.getByRole('button', { name: 'Add an item' }))
    await userEvent.type(body.getByRole('textbox', { name: 'Line 2 amount' }), '20')
    await userEvent.click(body.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    await expect(saved.mock.calls[0]?.[0]).toMatchObject({
      entry_mode: 'itemised',
      lines: [
        { amount: '108.10', category_id: 'exc_it', quantity: '2', unit_price: '54.05' },
        { amount: '20.00', category_id: null, quantity: null, unit_price: null },
      ],
    })
  },
}

/** Back to one amount asks before dropping what the items hold, then adds them up per VAT rate. */
export const MergeAsksFirst: Story = {
  play: async () => {
    await itemise()
    await userEvent.type(body.getByRole('textbox', { name: 'Line 1 description' }), 'Cable')
    await userEvent.type(body.getByRole('textbox', { name: 'Line 1 amount' }), '10')
    await userEvent.click(body.getByRole('button', { name: 'Add an item' }))
    await userEvent.type(body.getByRole('textbox', { name: 'Line 2 amount' }), '5.50')
    await userEvent.click(body.getByRole('radio', { name: 'One amount' }))
    const dialog = await body.findByRole('dialog', { name: 'Enter as one amount?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    await expect(body.getByRole('radio', { name: 'Items' })).toBeChecked()
    await expect(body.getByRole('textbox', { name: 'Line 2 amount' })).toHaveValue('5.50')
    await userEvent.click(body.getByRole('radio', { name: 'One amount' }))
    await userEvent.click(
      within(await body.findByRole('dialog', { name: 'Enter as one amount?' })).getByRole(
        'button',
        {
          name: 'Add up',
        },
      ),
    )
    await waitFor(() =>
      expect(body.queryByRole('dialog', { name: 'Enter as one amount?' })).toBeNull(),
    )
    await expect(body.getByRole('radio', { name: 'One amount' })).toBeChecked()
    await expect(body.getByRole('textbox', { name: 'Line 1 amount' })).toHaveValue('15.50')
    await expect(body.queryByRole('textbox', { name: 'Line 2 amount' })).toBeNull()
  },
}

/** A quantity of 0 is caught before saving, beside the item. */
export const ItemValidation: Story = {
  play: async () => {
    saved.mockClear()
    await userEvent.type(await itemise(), '0')
    await userEvent.type(body.getByRole('textbox', { name: 'Line 1 amount' }), '10')
    await userEvent.click(body.getByRole('button', { name: 'Save draft' }))
    await expect(await body.findByText('Enter a quantity above 0.')).toBeVisible()
    await expect(body.getByRole('textbox', { name: 'Line 1 quantity' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(saved).not.toHaveBeenCalled()
  },
}

/** The totals sit on a card like the app's others (Panel, elevation 1), not a ruled box. */
export const TotalsCard: Story = {
  play: async () => {
    const totals = await body.findByTestId('expense-totals')
    const card = totals.closest('[data-slot="panel"]')
    await expect(card).toHaveClass('shadow-elevation-1')
    await expect(card).not.toHaveClass('ring-1')
  },
}

/** On a phone each item is a card of its own, its fields two to a row. */
export const ItemisedPhone: Story = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async () => {
    await itemise()
    const item = body.getByTestId('expense-item')
    await waitFor(() =>
      expect(getComputedStyle(item).gridTemplateColumns.split(' ')).toHaveLength(2),
    )
  },
}

export const ItemisedDark: Story = {
  parameters: { dark: true },
  play: async () => {
    await itemise()
    await expect(body.getByRole('button', { name: 'Add an item' })).toBeVisible()
  },
}

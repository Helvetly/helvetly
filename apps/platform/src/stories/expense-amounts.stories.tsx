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
const chooseCategory = async (n: number, name: RegExp) => {
  await userEvent.click(body.getByRole('button', { name: `Actions for item ${n}` }))
  await userEvent.click(await body.findByRole('menuitem', { name: 'Category' }))
  await userEvent.click(await body.findByRole('menuitemradio', { name }))
}
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
    await chooseCategory(1, /IT & software/)
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

/** Two items in the form's column: one row each, # | item | qty | unit price | VAT | amount | menu, under one header
 * row, and nothing wider than the column. */
export const TwoItems: Story = {
  play: async () => {
    await itemise()
    await userEvent.click(body.getByRole('button', { name: 'Add an item' }))
    const items = body.getAllByTestId('expense-item')
    await expect(items).toHaveLength(2)
    const rows = items.map((item) => item.firstElementChild as HTMLElement)
    const column = items[0]?.parentElement?.getBoundingClientRect()
    await waitFor(() =>
      expect(
        rows.map((row) => getComputedStyle(row).gridTemplateColumns.split(' ').length),
      ).toEqual([7, 7]),
    )
    const overflowing = items
      .flatMap((item) => [...item.querySelectorAll('input, button')])
      .filter((field) => field.getBoundingClientRect().right > (column?.right ?? 0) + 0.5)
    await expect(overflowing).toEqual([])
    const description = body.getByRole('textbox', { name: 'Line 1 description' })
    const quantity = body.getByRole('textbox', { name: 'Line 1 quantity' })
    const amount = body.getByRole('textbox', { name: 'Line 1 amount' })
    await expect(description.getBoundingClientRect().width).toBeGreaterThan(120)
    // One row: every field of the item on the same line.
    await expect(amount.getBoundingClientRect().top).toBe(description.getBoundingClientRect().top)
    const [header] = body.getAllByText('Qty', { selector: 'span' })
    await expect(header?.getBoundingClientRect().right).toBe(quantity.getBoundingClientRect().right)
    await expect(body.getByText(/^2 items · Subtotal/)).toBeVisible()
  },
}

/** On a phone each item is a card: number, name and menu on top, the four figures in a row under them. */
export const ItemisedPhone: Story = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async () => {
    await itemise()
    const row = body.getByTestId('expense-item').firstElementChild as HTMLElement
    await waitFor(() =>
      expect(getComputedStyle(row).gridTemplateColumns.split(' ')).toHaveLength(3),
    )
    const description = body.getByRole('textbox', { name: 'Line 1 description' })
    const amount = body.getByRole('textbox', { name: 'Line 1 amount' })
    await expect(amount.getBoundingClientRect().top).toBeGreaterThan(
      description.getBoundingClientRect().bottom,
    )
  },
}

/** Booking needs every item named, beside the item; a draft saves without. */
export const ItemNamesNeededToBook: Story = {
  play: async () => {
    saved.mockClear()
    await itemise()
    await userEvent.type(body.getByRole('textbox', { name: 'Line 1 amount' }), '10')
    await userEvent.click(body.getByRole('button', { name: 'Save and book' }))
    await expect(await body.findByText('Name the item to book.')).toBeVisible()
    await expect(body.getByRole('textbox', { name: 'Line 1 description' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(saved).not.toHaveBeenCalled()
    await userEvent.click(body.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    await expect(saved.mock.calls[0]?.[0]).toMatchObject({
      entry_mode: 'itemised',
      lines: [{ description: null, amount: '10.00' }],
    })
  },
}

/** One amount on one line has no item field: "What for" names it, and booking asks for it. */
export const OneAmountNamedByWhatFor: Story = {
  play: async () => {
    saved.mockClear()
    await userEvent.type(await body.findByRole('textbox', { name: 'Line 1 amount' }), '10')
    await expect(body.queryByRole('textbox', { name: 'Line 1 description' })).toBeNull()
    await userEvent.click(body.getByRole('button', { name: 'Save and book' }))
    await expect(await body.findByText('Say what it was for to book.')).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Add a line for another VAT rate' }))
    await expect(body.getByRole('textbox', { name: 'Line 1 description' })).toBeVisible()
    await expect(body.getByRole('textbox', { name: 'Line 2 description' })).toBeVisible()
    await expect(saved).not.toHaveBeenCalled()
  },
}

/** Enter in the last item adds the next and puts the cursor in its name; elsewhere it goes down a row. */
export const EnterAddsAnItem: Story = {
  play: async () => {
    await userEvent.type(await itemise(), '2{Enter}')
    const second = body.getByRole('textbox', { name: 'Line 2 description' })
    await waitFor(() => expect(second).toHaveFocus())
    await userEvent.type(second, 'Ink')
    await userEvent.click(body.getByRole('textbox', { name: 'Line 1 unit price' }))
    await userEvent.keyboard('{Enter}')
    await expect(body.getByRole('textbox', { name: 'Line 2 unit price' })).toHaveFocus()
    await expect(body.getAllByTestId('expense-item')).toHaveLength(2)
    await expect(body.getByText(/^2 items · Subtotal/)).toBeVisible()
  },
}

/** An item's own category comes from its menu and shows as a chip under its name; the expense's is the default. */
export const ItemCategoryChip: Story = {
  play: async () => {
    await itemise()
    await expect(body.queryByTestId('item-category')).toBeNull()
    await chooseCategory(1, /IT & software/)
    await expect(await body.findByTestId('item-category')).toHaveTextContent('IT & software')
    await chooseCategory(1, /Expense's category/)
    await waitFor(() => expect(body.queryByTestId('item-category')).toBeNull())
  },
}

/** Delete and duplicate sit in the item's menu, not as a red button on every row. */
export const DeleteFromMenu: Story = {
  play: async () => {
    await itemise()
    await userEvent.type(body.getByRole('textbox', { name: 'Line 1 description' }), 'Cable')
    await userEvent.click(body.getByRole('button', { name: 'Actions for item 1' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Duplicate item' }))
    await expect(body.getByRole('textbox', { name: 'Line 2 description' })).toHaveValue('Cable')
    await userEvent.type(body.getByRole('textbox', { name: 'Line 2 description' }), ' 2')
    await userEvent.click(body.getByRole('button', { name: 'Actions for item 1' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Delete item' }))
    await waitFor(() => expect(body.getAllByTestId('expense-item')).toHaveLength(1))
    await expect(body.getByRole('textbox', { name: 'Line 1 description' })).toHaveValue('Cable 2')
    await expect(body.queryByRole('button', { name: /^Remove line/ })).toBeNull()
  },
}

const tenItems = expense({
  status: 'draft',
  entry_mode: 'itemised',
  lines: [
    ['Taxi Zürich HB', '1', '38.50', '8.1'],
    ['Hotel Bern, 2 nights', '2', '145.00', '3.8'],
    ['Breakfast', '2', '24.00', '8.1'],
    ['Train Bern–Basel', '1', '42.00', '8.1'],
    ['Parking', '3', '6.50', '8.1'],
    ['Client lunch', '1', '96.40', '8.1'],
    ['Printer paper', '5', '7.90', '8.1'],
    ['USB-C cable', '2', '19.95', '8.1'],
    ['Conference ticket', '1', '350.00', '8.1'],
    ['Coffee', '4', '4.80', '8.1'],
  ].map(([description, quantity, unit_price, vat_rate], i) => ({
    id: `eln_${i + 1}`,
    position: i + 1,
    description: description ?? null,
    quantity: quantity ?? null,
    unit_price: unit_price ?? null,
    amount: (Number(quantity) * Number(unit_price)).toFixed(2),
    vat_rate: vat_rate ?? '8.1',
    category:
      i === 7 ? { id: 'exc_it', name: 'IT & software', account_code: '6570', preset: null } : null,
  })),
})

/** Ten items read as a table: one row each, the own category of one as a chip, the count and subtotal below. */
export const TenItems: Story = {
  render: () => <ExpenseForm expense={tenItems} onClose={fn()} onSaved={fn()} />,
  play: async () => {
    await expect(await body.findAllByTestId('expense-item')).toHaveLength(10)
    await expect(await body.findByTestId('item-category')).toHaveTextContent('IT & software')
    await expect(body.getByText(/^10 items · Subtotal CHF\s983\.00$/)).toBeVisible()
  },
}

export const ItemisedDark: Story = {
  parameters: { dark: true },
  play: async () => {
    await itemise()
    await expect(body.getByRole('button', { name: 'Add an item' })).toBeVisible()
  },
}

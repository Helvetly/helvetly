import { expectButtonsDoNotSubmit } from '@helvetly/vitest-config/form-buttons'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientForm } from '@/components/clients/client-form'
import { ExpenseForm } from '@/components/expenses/expense-form'
import { ProductForm } from '@/components/products/product-form'
import type { ClientInput } from '@/lib/clients'
import type { Product, ProductInput } from '@/lib/products'
import { aiConsent, aiNotice } from '@/mocks/ai-notice'
import { sampleSettings } from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

const session = {
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role: 'owner',
  scopes: ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
}
const defaults = { currency: 'CHF', vat_registered: true, default_vat_rate: '8.1' }
const baseHandlers = [
  http.get('/api/v1/session', () => HttpResponse.json(session)),
  http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
  http.get('/api/v1/clients/tags', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/uid-register/search', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/expense-categories', () =>
    HttpResponse.json({
      data: [
        {
          id: 'exc_travel',
          name: 'Travel',
          account_code: '6640',
          is_archived: false,
          expenses_count: 0,
        },
      ],
    }),
  ),
  http.post('/api/v1/expenses/preview', () =>
    HttpResponse.json(
      { error: { code: 'validation_failed', message: 'Complete the amount.' } },
      { status: 422 },
    ),
  ),
]
const meta = {
  title: 'Financial forms/Drawers',
  parameters: { layout: 'fullscreen', msw: { handlers: baseHandlers } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const ProductOpeningFocus: Story = {
  play: async ({ mount }) => {
    await mount(<ProductForm defaults={defaults} onClose={fn()} onSaved={fn()} />)
    await expect(within(document.body).getByRole('textbox', { name: 'Name' })).toHaveFocus()
  },
}
// Every section heading carries its icon tile, as in the client form.
export const ProductSectionIcons: Story = {
  render: () => <ProductForm defaults={defaults} onClose={fn()} onSaved={fn()} />,
  play: async () => {
    const headings = within(document.body).getAllByRole('heading', { level: 3 })
    await expect(headings.map((heading) => heading.textContent)).toEqual([
      'Basics',
      'Price',
      'Details',
    ])
    await expect(
      headings.filter((heading) =>
        heading.parentElement?.querySelector('[data-slot="section-icon"] svg'),
      ),
    ).toHaveLength(3)
  },
}
const savedProduct = fn()
const productInput = fn()
const savedClient = fn()
const clientInput = fn()
const savedExpense = fn()

export const ProductRequiredFields: Story = {
  render: () => <ProductForm defaults={defaults} onClose={fn()} onSaved={savedProduct} />,
  play: async () => {
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Add item' }))
    await expect(body.getByText('Enter a name.')).toBeVisible()
    await expect(body.getByText('Enter a price.')).toBeVisible()
    await expect(body.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await expect(savedProduct).not.toHaveBeenCalled()
  },
}

export const ProductPreviewAndSingleSave: Story = {
  parameters: {
    msw: {
      handlers: [
        ...baseHandlers,
        http.post<never, ProductInput>('/api/v1/products', async ({ request }) => {
          const input = await request.json()
          productInput(input)
          await delay(250)
          return HttpResponse.json(
            { data: { ...input, id: 'prd_story', name: input.name } },
            { status: 201 },
          )
        }),
      ],
    },
  },
  render: () => <ProductForm defaults={defaults} onClose={fn()} onSaved={savedProduct} />,
  play: async () => {
    const body = within(document.body)
    await userEvent.type(body.getByRole('textbox', { name: 'Name' }), 'Web design')
    // A new item is priced gross: the preview takes the VAT out of what was typed.
    await expect(body.getByRole('radio', { name: 'Gross' })).toBeChecked()
    await userEvent.type(body.getByRole('textbox', { name: /Unit price/ }), '150')
    await expect(body.getByRole('status', { name: 'Price per unit' })).toHaveTextContent(
      'CHF 138.76',
    )
    await userEvent.keyboard('{Control>}{Enter}{Enter}{/Control}')
    await waitFor(() => expect(savedProduct).toHaveBeenCalledOnce())
    await expect(productInput).toHaveBeenCalledOnce()
    await expect(productInput).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_price: '150.00',
        price_basis: 'gross',
        vat_rate: '8.1',
        currency: 'CHF',
      }),
    )
  },
}

export const ProductServerValidation: Story = {
  parameters: {
    msw: {
      handlers: [
        ...baseHandlers,
        http.post('/api/v1/products', () =>
          HttpResponse.json(
            {
              error: {
                code: 'validation_failed',
                message: 'Check the fields.',
                details: { fields: { sku: 'Another active item already uses this SKU.' } },
              },
            },
            { status: 422 },
          ),
        ),
      ],
    },
  },
  render: () => <ProductForm defaults={defaults} onClose={fn()} onSaved={savedProduct} />,
  play: async () => {
    const body = within(document.body)
    await userEvent.type(body.getByRole('textbox', { name: 'Name' }), 'Hosting')
    await userEvent.type(body.getByRole('textbox', { name: /Unit price/ }), '20')
    await userEvent.type(body.getByRole('textbox', { name: /SKU/ }), 'HOST')
    await userEvent.click(body.getByRole('button', { name: 'Add item' }))
    await expect(await body.findByText('Another active item already uses this SKU.')).toBeVisible()
    await expect(body.getByRole('textbox', { name: /SKU/ })).toHaveFocus()
    await expect(savedProduct).not.toHaveBeenCalled()
  },
}

const netProduct: Product = {
  id: 'prd_net',
  type: 'service',
  name: 'Consulting',
  description: 'Strategy sessions.',
  sku: null,
  gtin: null,
  unit: 'hour',
  price_basis: 'net',
  unit_price: '150.00',
  unit_price_net: '150.00',
  unit_price_gross: '162.15',
  currency: 'CHF',
  vat_category: 'S',
  vat_rate: '8.1',
  is_archived: false,
  archived_at: null,
  created_at: '2026-11-18T10:00:00Z',
  updated_at: '2026-11-18T10:00:00Z',
}

/** Editing keeps the saved price basis; currency, price and Net|Gross share one row, the VAT rate sits beside VAT. */
export const ProductEditKeepsNet: Story = {
  render: () => (
    <ProductForm product={netProduct} defaults={defaults} onClose={fn()} onSaved={fn()} />
  ),
  play: async () => {
    const body = within(document.body)
    await expect(body.getByRole('radio', { name: 'Net' })).toBeChecked()
    await expect(body.getByRole('status', { name: 'Price per unit' })).toHaveTextContent(
      'CHF 162.15',
    )
    const price = body.getByRole('textbox', { name: /Unit price/ })
    const currency = body.getByRole('button', { name: 'Currency CHF' })
    await expect(currency.getBoundingClientRect().top).toBe(price.getBoundingClientRect().top)
    await expect(currency.getBoundingClientRect().height).toBe(price.getBoundingClientRect().height)
    const rate = body.getByRole('textbox', { name: 'VAT rate' })
    const category = document.getElementById('product-vat_category')
    await expect(category?.getBoundingClientRect().top).toBe(rate.getBoundingClientRect().top)
    await expect(rate.getBoundingClientRect().width).toBeLessThan(120)
    await userEvent.click(currency)
    await expect(body.getByRole('dialog', { name: 'Currency' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
  },
}

/** Write with AI and the count sit inside the description's border; long text scrolls above them, never under. */
export const ProductDescriptionTools: Story = {
  render: () => <ProductForm defaults={defaults} onClose={fn()} onSaved={fn()} />,
  play: async () => {
    const body = within(document.body)
    const description = body.getByRole('textbox', { name: /Description/ })
    const box = description.closest('[data-slot=textarea-box]')
    const ai = body.getByRole('button', { name: 'Write with AI' })
    await expect(box).toContainElement(ai)
    await expect(box).toHaveTextContent('0 / 1000')
    await userEvent.click(description)
    await userEvent.paste(Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join('\n'))
    await expect(box).toHaveTextContent('/ 1000')
    const text = description.getBoundingClientRect()
    await expect(text.bottom).toBeLessThanOrEqual(ai.getBoundingClientRect().top)
    await expect(box?.getBoundingClientRect().bottom).toBeGreaterThan(
      ai.getBoundingClientRect().bottom,
    )
  },
}

export const ProductUnsavedChanges: Story = {
  render: () => <ProductForm defaults={defaults} onClose={fn()} onSaved={savedProduct} />,
  play: async () => {
    const body = within(document.body)
    await userEvent.type(body.getByRole('textbox', { name: 'Name' }), 'Unsaved service')
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }))
    await expect(body.getByRole('dialog')).toHaveTextContent(/Discard/)
    await userEvent.click(body.getByRole('button', { name: 'Keep editing' }))
    await expect(body.getByRole('textbox', { name: 'Name' })).toHaveValue('Unsaved service')
  },
}

export const ClientSingleSave: Story = {
  parameters: {
    msw: {
      handlers: [
        ...baseHandlers,
        http.post<never, ClientInput>('/api/v1/clients', async ({ request }) => {
          const input = await request.json()
          clientInput(input)
          await delay(250)
          return HttpResponse.json(
            { data: sampleClient({ ...input, id: 'cli_story' }) },
            { status: 201 },
          )
        }),
      ],
    },
  },
  render: () => <ClientForm onClose={fn()} onSaved={savedClient} />,
  play: async () => {
    const body = within(document.body)
    await userEvent.type(body.getByRole('textbox', { name: 'Company name' }), 'Sprüngli AG')
    await userEvent.keyboard('{Control>}{Enter}{Enter}{/Control}')
    await waitFor(() => expect(savedClient).toHaveBeenCalledOnce())
    await expect(clientInput).toHaveBeenCalledOnce()
    await expect(clientInput).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sprüngli AG' }))
  },
}

export const ClientServerValidation: Story = {
  parameters: {
    msw: {
      handlers: [
        ...baseHandlers,
        http.post('/api/v1/clients', () =>
          HttpResponse.json(
            {
              error: {
                code: 'validation_failed',
                message: 'Check the fields.',
                details: { fields: { email: 'This email is already used by #4.' } },
              },
            },
            { status: 422 },
          ),
        ),
      ],
    },
  },
  render: () => <ClientForm onClose={fn()} onSaved={savedClient} />,
  play: async () => {
    const body = within(document.body)
    // Wait for the form's own start focus, or it can land on Company name in the middle of the email.
    await waitFor(() => expect(body.getByRole('textbox', { name: 'Company name' })).toHaveFocus())
    await userEvent.type(body.getByRole('textbox', { name: 'Company name' }), 'Sprüngli AG')
    await userEvent.type(body.getByLabelText('Email'), 'info@example.com')
    await userEvent.click(body.getByRole('button', { name: 'Add client' }))
    await expect(await body.findByText('This email is already used by #4.')).toBeVisible()
    await expect(body.getByLabelText('Email')).toHaveFocus()
    await expect(body.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  },
}

export const ExpenseIncompleteBooking: Story = {
  render: () => <ExpenseForm onClose={fn()} onSaved={savedExpense} />,
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'Save and book' }))
    await waitFor(() => expect(body.getByText('Enter the supplier to book.')).toBeVisible())
    await expect(body.getByText('Choose a category to book.')).toBeVisible()
    await expect(body.getByRole('textbox', { name: /Supplier$/ })).toHaveFocus()
    await expect(savedExpense).not.toHaveBeenCalled()
  },
}

export const ExpenseServerValidation: Story = {
  parameters: {
    msw: {
      handlers: [
        ...baseHandlers,
        http.post('/api/v1/expenses', () =>
          HttpResponse.json(
            {
              error: {
                code: 'validation_failed',
                message: 'Check the fields.',
                details: {
                  fields: { supplier_vat_number: 'This UID does not exist: check its digits.' },
                },
              },
            },
            { status: 422 },
          ),
        ),
      ],
    },
  },
  render: () => <ExpenseForm onClose={fn()} onSaved={savedExpense} />,
  play: async () => {
    const body = within(document.body)
    // The form puts focus on Supplier shortly after it opens; typing before that lands half the UID
    // there, the UID fails the form's own check and the server's answer never comes.
    await waitFor(() => expect(body.getByRole('textbox', { name: /Supplier$/ })).toHaveFocus())
    await userEvent.type(body.getByRole('textbox', { name: /Supplier VAT/ }), 'CHE-123.456.789')
    await userEvent.click(body.getByRole('button', { name: 'Save draft' }))
    await expect(await body.findByText('This UID does not exist: check its digits.')).toBeVisible()
    await expect(body.getByRole('textbox', { name: /Supplier VAT/ })).toHaveFocus()
  },
}

export const ExpenseCreateCategory: Story = {
  parameters: {
    msw: {
      handlers: [
        ...baseHandlers,
        http.post('/api/v1/expense-categories', () =>
          HttpResponse.json(
            {
              data: {
                id: 'exc_new',
                name: 'Software',
                account_code: '6700',
                is_archived: false,
                expenses_count: 0,
              },
            },
            { status: 201 },
          ),
        ),
      ],
    },
  },
  render: () => <ExpenseForm onClose={fn()} onSaved={savedExpense} />,
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: /^Category/ }))
    await expect(await body.findByRole('option', { name: 'Add category' })).toBeVisible()
    await userEvent.keyboard('Software')
    await expect(body.getByRole('option', { name: 'Add “Software”' })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await expect(await body.findByRole('textbox', { name: 'Category name' })).toHaveValue(
      'Software',
    )
    await userEvent.click(body.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(body.queryByRole('textbox', { name: 'Category name' })).toBeNull())
  },
}

const catalogue = [
  // In the API's order: account, then name.
  ['exc_rent', 'Rent & premises', '6000', 'rent', 'exempt'],
  ['exc_lodging', 'Lodging', '6640', 'lodging', 'lodging'],
  ['exc_travel', 'Travel', '6640', 'travel', 'standard'],
  ['exc_old', 'Old costs', '6700', null, null],
].map(([id, name, account_code, preset, vat_treatment]) => ({
  id,
  name,
  account_code,
  preset,
  vat_treatment,
  is_archived: id === 'exc_old',
  expenses_count: 0,
}))

/** A category suggests its usual VAT rate for lines still at the last suggestion; a rate someone typed stays. */
export const ExpenseCategorySuggestsVAT: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/expense-categories', () => HttpResponse.json({ data: catalogue })),
        ...baseHandlers,
      ],
    },
  },
  render: () => <ExpenseForm onClose={fn()} onSaved={savedExpense} />,
  play: async () => {
    const body = within(document.body)
    const rate = await body.findByRole('combobox', { name: 'Line 1 VAT rate' })
    await expect(rate).toHaveValue('8.1')
    const pick = async (name: RegExp) => {
      await userEvent.click(body.getByRole('button', { name: /^Category/ }))
      await userEvent.click(await body.findByRole('option', { name }))
    }
    await expect(body.getByRole('button', { name: /^Category/ })).toBeEnabled()
    await pick(/Lodging/)
    await waitFor(() => expect(rate).toHaveValue('3.8'))
    await pick(/Rent & premises/)
    await waitFor(() => expect(rate).toHaveValue('0'))
    await userEvent.clear(rate)
    await userEvent.type(rate, '2.6')
    await pick(/Travel/)
    await expect(rate).toHaveValue('2.6')
  },
}

/** The picker lists categories under their account headings and finds one by its account code. */
export const ExpenseCategoryGroups: Story = {
  parameters: ExpenseCategorySuggestsVAT.parameters,
  render: () => <ExpenseForm onClose={fn()} onSaved={savedExpense} />,
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: /^Category/ }))
    const travel = await body.findByRole('group', { name: 'Marketing & travel' })
    await expect(travel.textContent).toMatch(/Lodging.*Travel/)
    await expect(body.getByRole('group', { name: 'Premises & equipment' })).toBeVisible()
    await expect(body.queryByRole('option', { name: /Old costs/ })).toBeNull()
    await userEvent.keyboard('6000')
    await expect(body.getByRole('option', { name: /Rent & premises/ })).toBeVisible()
    await expect(body.queryByRole('option', { name: /Travel/ })).toBeNull()
  },
}

/** Reading a receipt fills a line per VAT rate and the category, and names what the AI was unsure of. */
export const ExpenseReceiptReading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/heidi/usage', () =>
          HttpResponse.json({
            period: '2026-11',
            tokens_used: 0,
            tokens_included: 500_000,
            tokens_purchased: 0,
            tokens_remaining: 500_000,
            provider_available: true,
            consent: aiConsent(true),
          }),
        ),
        http.get('/api/v1/heidi/consent', () =>
          HttpResponse.json({ data: aiConsent(true), notice: aiNotice }),
        ),
        http.post('/api/v1/expenses/receipt-preview', () =>
          HttpResponse.json({
            data: {
              supplier: { name: 'Swisscom', vat_number: null, country: 'CH', iban: null },
              document: { type: 'invoice', number: 'R-12', date: '2026-11-03', due_date: null },
              description: null,
              currency: 'CHF',
              totals: { net: '200.00', vat: '10.70', gross: '210.70' },
              vat_breakdown: [
                { rate: '8.1', net: '100.00', vat: '8.10', gross: '108.10' },
                { rate: '2.6', net: '100.00', vat: '2.60', gross: '102.60' },
              ],
              items: [],
              payment: { status: 'unknown', method: null, paid_on: null },
              reverse_charge: false,
              category: {
                id: 'exc_travel',
                name: 'Travel',
                account_code: '6640',
                confidence: 0.4,
                reason: null,
              },
              confidence: {},
              issues: {},
            },
          }),
        ),
        ...baseHandlers,
      ],
    },
  },
  render: () => (
    <ExpenseForm
      onClose={fn()}
      onSaved={savedExpense}
      initialFiles={[new File(['x'], 'swisscom.png', { type: 'image/png' })]}
    />
  ),
  play: async () => {
    const body = within(document.body)
    const recognize = await body.findByRole('button', { name: 'Read with AI' })
    const supplier = body.getByRole('textbox', { name: /Supplier$/ })
    // The AI approval belongs to the signed-in person and workspace: a click before the session has loaded is
    // dropped without sending anything, so it is clicked again until the reading lands.
    await waitFor(async () => {
      if (
        recognize.hasAttribute('disabled') === false &&
        supplier.getAttribute('value') !== 'Swisscom'
      )
        await userEvent.click(recognize)
      await expect(supplier).toHaveValue('Swisscom')
    })
    await expect(body.getByRole('textbox', { name: 'Line 2 amount' })).toHaveValue('102.60')
    await expect(body.getByText('The AI was unsure, check: Category.')).toBeVisible()
  },
}

/** A line's amount takes only a number, with the form's currency inside; its VAT rate only 0 to 100. */
export const ExpenseAmountFields: Story = {
  render: () => <ExpenseForm onClose={fn()} onSaved={savedExpense} />,
  play: async () => {
    const body = within(document.body)
    const amount = await body.findByRole('textbox', { name: 'Line 1 amount' })
    await expect(amount.parentElement).toHaveTextContent('CHF')
    await expect(amount).toHaveClass('text-right')
    await userEvent.type(amount, '22ssss')
    await expect(amount).toHaveValue('22')
    await expect(body.getByText('A number of 0 or more, with at most two decimals.')).toBeVisible()
    const rate = body.getByRole('combobox', { name: 'Line 1 VAT rate' })
    await userEvent.clear(rate)
    await userEvent.type(rate, '150')
    await expect(rate).toHaveValue('100')
    await userEvent.clear(rate)
    await userEvent.type(rate, '8.1x')
    await expect(rate).toHaveValue('8.1')
    await userEvent.click(body.getByRole('button', { name: /^Currency/ }))
    await userEvent.click(await body.findByRole('option', { name: /EUR/ }))
    await waitFor(() => expect(amount.parentElement).toHaveTextContent('EUR'))
  },
}

// Only the save button saves: every other button in these forms leaves the drawer open and unsaved.
export const ProductButtonsDoNotSubmit: Story = {
  render: () => <ProductForm defaults={defaults} onClose={fn()} onSaved={savedProduct} />,
  play: async () => {
    await expectButtonsDoNotSubmit(document.body)
    await expect(savedProduct).not.toHaveBeenCalled()
  },
}
export const ClientButtonsDoNotSubmit: Story = {
  render: () => <ClientForm onClose={fn()} onSaved={savedClient} />,
  play: async () => {
    await expectButtonsDoNotSubmit(document.body)
    await expect(savedClient).not.toHaveBeenCalled()
  },
}
export const ExpenseButtonsDoNotSubmit: Story = {
  render: () => <ExpenseForm onClose={fn()} onSaved={savedExpense} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector('form button')).not.toBeNull())
    // Save draft saves on purpose, as a second save button beside Save and book.
    await expectButtonsDoNotSubmit(document.body, { skip: /^Save draft$/ })
    await expect(savedExpense).not.toHaveBeenCalled()
  },
}

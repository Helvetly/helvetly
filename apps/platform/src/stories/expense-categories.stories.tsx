import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { ExpenseCategoriesSheet } from '@/components/expenses/expense-categories-sheet'
import type { ExpenseCategory, VatTreatment } from '@/lib/expenses'

const fixture: [string, string, string, VatTreatment | null, number, boolean][] = [
  // In the API's order: account, then name.
  ['exc_materials', 'Materials', '4000', 'standard', 3, false],
  ['exc_recruiting', 'Recruiting', '5800', 'standard', 0, false],
  ['exc_training', 'Training', '5800', 'exempt', 1, false],
  ['exc_rent', 'Rent', '6000', 'none', 12, false],
  ['exc_books', 'Books', '6500', 'reduced', 0, false],
  ['exc_hotels', 'Hotels', '6640', 'lodging', 2, false],
  ['exc_old', 'Old costs', '6700', null, 0, true],
]
const initial = (): ExpenseCategory[] =>
  fixture.map(([id, name, account_code, vat_treatment, expenses_count, is_archived]) => ({
    id,
    name,
    account_code,
    preset: null,
    vat_treatment,
    is_archived,
    expenses_count,
  }))

const treatments: VatTreatment[] = ['standard', 'reduced', 'lodging', 'exempt', 'none']
let categories = initial()
let writes: { method: string; body: Record<string, unknown> }[] = []

const meta = {
  title: 'Expenses/Categories drawer',
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get('/api/v1/expense-categories', () => HttpResponse.json({ data: categories })),
        http.post<never, Record<string, unknown>>(
          '/api/v1/expense-categories',
          async ({ request }) => {
            const body = await request.json()
            writes.push({ method: 'POST', body })
            const made: ExpenseCategory = {
              id: 'exc_new',
              name: String(body.name),
              account_code: String(body.account_code),
              preset: null,
              vat_treatment: treatments.find((t) => t === body.vat_treatment) ?? null,
              is_archived: false,
              expenses_count: 0,
            }
            categories = [...categories, made]
            return HttpResponse.json({ data: made }, { status: 201 })
          },
        ),
        http.patch<{ id: string }, Record<string, unknown>>(
          '/api/v1/expense-categories/:id',
          async ({ params, request }) => {
            const body = await request.json()
            writes.push({ method: 'PATCH', body })
            categories = categories.map((c) => (c.id === params.id ? { ...c, ...body } : c))
            return HttpResponse.json({ data: categories.find((c) => c.id === params.id) })
          },
        ),
      ],
    },
  },
  beforeEach: () => {
    categories = initial()
    writes = []
  },
  render: () => <ExpenseCategoriesSheet onClose={fn()} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const row = (name: string) => {
  const item = body().getByText(name, { selector: 'span' }).closest('li')
  if (!item) throw new Error(`no row for ${name}`)
  return item
}

/** Groups with their tiles; each VAT treatment has its badge; the account is a code pill. */
export const Groups: Story = {
  play: async () => {
    await expect(await body().findByRole('heading', { name: 'Materials & services' })).toBeVisible()
    for (const group of ['Staff', 'Premises & equipment', 'Administration & IT'])
      expect(body().getByRole('heading', { name: group })).toBeVisible()
    await expect(body().getByText('2 categories')).toBeVisible()
    const badges: [string, VatTreatment, string][] = [
      ['Materials', 'standard', 'Standard 8.1%'],
      ['Books', 'reduced', 'Reduced 2.6%'],
      ['Hotels', 'lodging', 'Accommodation 3.8%'],
      ['Rent', 'none', 'No VAT'],
      ['Training', 'exempt', 'Exempt'],
    ]
    for (const [name, treatment, text] of badges) {
      const badge = within(row(name)).getByText(text)
      expect(badge).toHaveAttribute('data-vat', treatment)
    }
    await expect(within(row('Rent')).getByText('6000', { selector: 'code' })).toBeVisible()
    await expect(within(row('Rent')).getByText('12 expenses')).toBeVisible()
  },
}

/** The search finds by name or account code; nothing found says so. */
export const Search: Story = {
  play: async () => {
    const search = await body().findByRole('searchbox', { name: 'Search name or account' })
    await body().findByText('Materials')
    await userEvent.type(search, '5800')
    await expect(body().getByText('Recruiting')).toBeVisible()
    await expect(body().getByText('Training')).toBeVisible()
    await expect(body().queryByText('Materials')).toBeNull()
    await userEvent.clear(search)
    await userEvent.type(search, 'hot')
    await expect(body().getByText('Hotels')).toBeVisible()
    await expect(body().queryByText('Rent')).toBeNull()
    await userEvent.type(search, 'zzz')
    await expect(body().getByText('No categories match your search.')).toBeVisible()
  },
}

/** Archived categories wait behind the toggle, dimmed in their group with a badge. */
export const ShowArchived: Story = {
  play: async () => {
    await body().findByText('Materials')
    await expect(body().queryByText('Old costs')).toBeNull()
    await userEvent.click(body().getByRole('switch', { name: 'Show archived' }))
    const old = row('Old costs')
    await expect(within(old).getByText('Archived')).toBeVisible()
    await expect(body().getByRole('heading', { name: 'Other' })).toBeVisible()
  },
}

/** An account two categories share is only a note: who else uses it, in a tooltip. */
export const SharedAccount: Story = {
  play: async () => {
    await body().findByText('Training')
    await expect(
      within(row('Materials')).queryByRole('button', { name: /Also used by/ }),
    ).toBeNull()
    const info = within(row('Training')).getByRole('button', { name: 'Also used by: Recruiting' })
    await userEvent.hover(info)
    await expect(await body().findByRole('tooltip')).toHaveTextContent('Also used by: Recruiting')
  },
}

/** The "…" menu and the right-click menu are the same: Edit, then Archive alone and last. */
export const RowMenus: Story = {
  play: async () => {
    await body().findByText('Rent')
    await userEvent.click(within(row('Rent')).getByRole('button', { name: 'More actions' }))
    const menu = await body().findByRole('menu')
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    await expect(items).toEqual(['Edit', 'Archive'])
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body().queryByRole('menu')).toBeNull())
    fireEvent.contextMenu(row('Rent'))
    const context = await body().findByRole('menu')
    await expect(
      within(context)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(items)
    await userEvent.click(within(context).getByRole('menuitem', { name: 'Archive' }))
    await waitFor(() => expect(writes).toEqual([{ method: 'PATCH', body: { is_archived: true } }]))
    await waitFor(() => expect(body().queryByText('Rent')).toBeNull())
    await userEvent.click(body().getByRole('switch', { name: 'Show archived' }))
    await userEvent.click(within(row('Rent')).getByRole('button', { name: 'Unarchive' }))
    await waitFor(() =>
      expect(writes[1]).toEqual({ method: 'PATCH', body: { is_archived: false } }),
    )
  },
}

/** Edit opens the same form in place; only what changed is sent. */
export const EditInPlace: Story = {
  play: async () => {
    await body().findByText('Books')
    await userEvent.click(within(row('Books')).getByRole('button', { name: 'More actions' }))
    await userEvent.click(await body().findByRole('menuitem', { name: 'Edit' }))
    const form = body().getByRole('form', { name: 'Edit' })
    await expect(within(form).getByRole('textbox', { name: /Category name/ })).toHaveFocus()
    await expect(within(form).getByRole('button', { name: /Group/ })).toHaveTextContent(
      'Administration & IT',
    )
    await userEvent.click(within(form).getByRole('button', { name: /Default VAT rate/ }))
    await userEvent.click(await body().findByRole('option', { name: /Standard/ }))
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(writes).toEqual([{ method: 'PATCH', body: { vat_treatment: 'standard' } }]),
    )
    await waitFor(() => expect(body().queryByRole('form')).toBeNull())
    await expect(within(row('Books')).getByText('Standard 8.1%')).toBeVisible()
  },
}

/** Add category: an inline form on top; the group narrows the chart's accounts; the new one lights up in its group. */
export const Create: Story = {
  play: async () => {
    await body().findByText('Materials')
    await userEvent.click(body().getByRole('button', { name: 'Add category' }))
    const form = body().getByRole('form', { name: 'Add category' })
    const name = within(form).getByRole('textbox', { name: /Category name/ })
    await expect(name).toHaveFocus()
    await expect(within(form).getByRole('button', { name: /Group/ })).toHaveTextContent('Other')
    await expect(within(form).getByRole('button', { name: /Default VAT rate/ })).toHaveTextContent(
      'Standard',
    )
    // Taken names and a missing account are named before anything is sent.
    await userEvent.type(name, 'rent')
    await userEvent.click(within(form).getByRole('button', { name: 'Save category' }))
    await expect(within(form).getByText('Another category already has this name.')).toBeVisible()
    await expect(within(form).getByText(/4-digit number/)).toBeVisible()
    await expect(writes).toEqual([])

    await userEvent.clear(name)
    await userEvent.type(name, 'Coworking')
    await userEvent.click(within(form).getByRole('button', { name: /Group/ }))
    await userEvent.click(await body().findByRole('option', { name: 'Premises & equipment' }))
    await userEvent.click(within(form).getByRole('button', { name: /^Account code/ }))
    await expect(await body().findByRole('option', { name: /6000 · Rent/ })).toBeVisible()
    await expect(body().queryByRole('option', { name: /6640/ })).toBeNull()
    // A number the chart lacks is taken as typed.
    await userEvent.keyboard('6015')
    await userEvent.click(await body().findByRole('option', { name: /6015/ }))
    await expect(within(form).getByRole('button', { name: /^Account code/ })).toHaveTextContent(
      '6015',
    )
    await userEvent.click(within(form).getByRole('button', { name: 'Save category' }))
    await waitFor(() =>
      expect(writes).toEqual([
        {
          method: 'POST',
          body: { name: 'Coworking', account_code: '6015', vat_treatment: 'standard' },
        },
      ]),
    )
    await waitFor(() => expect(body().queryByRole('form')).toBeNull())
    const made = await waitFor(() => row('Coworking'))
    await expect(made).toHaveAttribute('data-highlighted', 'true')
    await expect(made.closest('section')?.querySelector('h3')?.textContent).toBe(
      'Premises & equipment',
    )
  },
}

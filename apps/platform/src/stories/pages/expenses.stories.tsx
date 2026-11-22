import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ExpensesPage } from '@/components/expenses/expenses-page'
import type { Session } from '@/lib/api'

import { storySession } from '../screen-fixtures'
import { filtersPlay } from './filters'
import {
  barsBetweenDataColumns,
  closeHeidi,
  dark,
  desktop,
  Frame,
  pageParameters,
  phone,
  shows,
} from './frame'
import { dropOpensImport, emptyList, noDropTarget, readOnly } from './page-drop'

const meta = {
  title: 'Pages/Expenses',
  beforeEach: closeHeidi,
  parameters: pageParameters('/expenses'),
  render: () => (
    <Frame>
      <ExpensesPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { play: shows('Swisscom (Schweiz) AG') }
export const ListDark = dark(List)
export const ListResizeBars: Story = {
  play: async ({ canvasElement }) => barsBetweenDataColumns(canvasElement),
}
export const ListPhone = phone(List)

export const Detail: Story = {
  parameters: pageParameters('/expenses', { id: 'exp_1' }),
  play: shows('Zürich–Bern return'),
}
export const DetailDark = dark(Detail)
export const DetailPhone = phone(Detail)

/** On a phone the header keeps the active tab and puts the rest under "More": no tab scrolls away. */
export const HeaderTabsPhone: Story = {
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await shows('Swisscom (Schweiz) AG')?.(context)
    const body = within(document.body)
    const views = body.getByRole('navigation', { name: 'Views' })
    expect(views.scrollWidth).toBeLessThanOrEqual(views.clientWidth)
    expect(within(views).getByRole('button', { current: 'page' })).toHaveTextContent('All')
    await userEvent.click(within(views).getByRole('button', { name: /^More views/ }))
    const hidden = await body.findByRole('menuitem', { name: 'Void' })
    await waitFor(() => expect(hidden).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
  },
}
export const HeaderTabsPhoneDark = dark(HeaderTabsPhone)

/** At desktop width every tab fits: no "More". */
export const HeaderTabsFit: Story = {
  play: async (context) => {
    await shows('Swisscom (Schweiz) AG')?.(context)
    const views = within(document.body).getByRole('navigation', { name: 'Views' })
    for (const tab of ['All', 'To review', 'Unpaid', 'To reimburse', 'Void'])
      expect(within(views).getByRole('button', { name: new RegExp(`^${tab}`) })).toBeVisible()
    expect(within(views).queryByRole('button', { name: /^More views/ })).toBeNull()
  },
}

const SCOPE_NOTICE = 'Input tax follows Swiss rules'
const previewed = fn()
const business = (country: string, who: Partial<Session> = {}) =>
  pageParameters('/expenses', {}, [
    // The new expense form asks for its totals; an empty form has no amount yet, as the API says.
    http.post('/api/v1/expenses/preview', () => {
      previewed()
      return HttpResponse.json(
        { error: { code: 'validation_failed', message: 'Complete the amount.' } },
        { status: 422 },
      )
    }),
    http.get('/api/v1/session', () =>
      HttpResponse.json({
        ...storySession,
        ...who,
        workspace: { ...storySession.workspace, country },
      }),
    ),
    // Whoever cannot read the invoice settings is refused them; the notice must not need them.
    ...(who.role === 'member'
      ? [
          http.get('/api/v1/invoice-settings', () =>
            HttpResponse.json(
              { error: { code: 'forbidden', message: 'No access' } },
              { status: 403 },
            ),
          ),
        ]
      : []),
  ])

/** A Swiss business: Swiss rules are the business's own, so the list carries no extra notice. */
export const SwissBusiness: Story = {
  parameters: business('CH'),
  play: async (context) => {
    await shows('Swisscom (Schweiz) AG')?.(context)
    expect(within(document.body).queryByText(SCOPE_NOTICE)).toBeNull()
  },
}

/** A German business sees, under the tabs and in the form's input tax, that the defaults are Swiss. */
export const ForeignBusiness: Story = {
  parameters: business('DE'),
  play: async (context) => {
    previewed.mockClear()
    await shows('Swisscom (Schweiz) AG', SCOPE_NOTICE)?.(context)
    const body = within(document.body)
    const notice = body.getByText(SCOPE_NOTICE).closest('[data-slot="callout"]')
    expect(notice).toHaveTextContent('Your business’s country is Germany')
    expect(notice).toHaveTextContent('Switzerland and Liechtenstein count as domestic')
    expect(notice).toHaveTextContent('does not switch to that country’s accounting')
    // Under the tabs, above the figures and the list.
    const views = body.getByRole('navigation', { name: 'Views' })
    expect(
      notice && views.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await userEvent.click(body.getAllByRole('button', { name: 'New expense' })[0] ?? document.body)
    // The receipt comes first; typing it in skips to the form. The loading sheet gives way to the form's own sheet:
    // look the dialog up again each time.
    await userEvent.click(
      await body.findByRole('button', { name: 'Enter manually' }, { timeout: 8000 }),
    )
    await waitFor(
      () => expect(within(body.getByRole('dialog')).getByText(SCOPE_NOTICE)).toBeVisible(),
      { timeout: 8000 },
    )
    await waitFor(() => expect(previewed).toHaveBeenCalled())
  },
}
export const ForeignBusinessDark = dark(ForeignBusiness)
export const ForeignBusinessPhone = phone(ForeignBusiness)

/** A member who reads expenses but not the invoice settings still gets the notice from the session. */
export const ForeignBusinessWithoutInvoiceSettings: Story = {
  parameters: business('DE', { role: 'member', scopes: ['read:expenses'] }),
  play: shows('Swisscom (Schweiz) AG', SCOPE_NOTICE),
}

/** The empty list offers Import receipts and says a receipt can be dropped anywhere. */
export const Empty: Story = {
  parameters: emptyList('/expenses', '/api/v1/expenses'),
  play: async () => {
    const body = within(document.body)
    await body.findByText('No expenses yet', {}, { timeout: 8000 })
    await expect(body.getByText('or drop a receipt anywhere on this page')).toBeVisible()
    await expect(body.getByRole('button', { name: 'Import receipts' })).toBeVisible()
  },
}
export const EmptyDark = dark(Empty)
export const EmptyPhone = phone(Empty)

/** A receipt dropped anywhere on the page opens the receipt import with it chosen. */
export const DropStartsImport: Story = {
  parameters: emptyList('/expenses', '/api/v1/expenses'),
  play: dropOpensImport(
    'No expenses yet',
    'Drop to read these receipts into draft expenses',
    'expenses',
    new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' }),
  ),
}

/** Whoever may only read has no drop target. */
export const ReadOnlyNoDrop: Story = {
  parameters: readOnly('/expenses'),
  play: noDropTarget('Swisscom (Schweiz) AG', 'expenses'),
}

/** The Filters popover and the search's chips show the URL's filters; a pick and "Clear all" go to the URL. */
export const Filters: Story = {
  parameters: pageParameters('/expenses', { receipt: 'missing', min: '20' }),
  play: filtersPlay({
    chips: ['Receipt: Without receipt', 'Min. amount: 20'],
    pick: { control: /^Currency/, option: /^Euro/, key: 'currency', value: 'EUR' },
    cleared: ['receipt', 'min', 'currency'],
  }),
}

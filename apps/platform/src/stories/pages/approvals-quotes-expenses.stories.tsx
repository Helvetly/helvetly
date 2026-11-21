import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { ExpensesPage } from '@/components/expenses/expenses-page'
import { QuotesPage } from '@/components/quotes/quotes-page'
import { ApprovalsSettings } from '@/components/settings/approvals-settings'
import {
  approvalHandlers,
  approvalOf,
  approvalStateOf,
  configuredApprovals,
  inboxItem,
  resetApprovals,
} from '@/mocks/approvals'
import { emailTemplateHandlers } from '@/mocks/email-templates'
import { quoteHandlers, resetQuotesMock, sampleQuote } from '@/mocks/quotes'

import { expense } from './api'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone } from './frame'

const business = http.get('/api/v1/billing', () =>
  HttpResponse.json({
    data: billingFixture({ locked: false, plan: 'business', status: 'active' }),
  }),
)

const QUOTE = 'quo_draft'
const EXPENSE = 'exp_draft'
// The drafts' approval state follows the mock's request, as the API derives it.
const draftQuote = http.get(`/api/v1/quotes/${QUOTE}`, () =>
  HttpResponse.json({
    data: sampleQuote({ id: QUOTE, approval_state: approvalStateOf(QUOTE) }),
  }),
)
const draftExpense = () =>
  expense({
    id: EXPENSE,
    number: 7,
    status: 'draft',
    supplier_name: 'Digitec Galaxus AG',
    description: 'Laptop',
    total: '1890.00',
    booked_at: null,
    booked_by: null,
    approval_state: approvalStateOf(EXPENSE),
  })
const expenseHandlers = [
  http.get(`/api/v1/expenses/${EXPENSE}`, () => HttpResponse.json({ data: draftExpense() })),
  http.get('/api/v1/expenses', () =>
    HttpResponse.json({
      data: [draftExpense()],
      meta: { page: 1, per_page: 50, total: 1, total_pages: 1 },
    }),
  ),
]
const approvalRequired = (path: string) =>
  http.post(path, () =>
    HttpResponse.json(
      { error: { code: 'approval_required', message: 'This document needs approval first.' } },
      { status: 409 },
    ),
  )

const quotesPage = (query: Record<string, string> = {}, ...handlers: RequestHandler[]) =>
  pageParameters('/quotes', query, [
    ...handlers,
    business,
    draftQuote,
    ...approvalHandlers,
    ...quoteHandlers,
    ...emailTemplateHandlers,
  ])
const expensesPage = (query: Record<string, string> = {}, ...handlers: RequestHandler[]) =>
  pageParameters('/expenses', query, [
    ...handlers,
    business,
    ...expenseHandlers,
    ...approvalHandlers,
  ])

const meta = {
  title: 'Pages/Approvals of quotes and expenses',
  beforeEach: () => {
    closeHeidi()
    resetApprovals()
    resetQuotesMock()
  },
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj

const body = () => within(document.body)
const quotes = () => (
  <Frame>
    <QuotesPage />
  </Frame>
)
const expenses = () => (
  <Frame>
    <ExpensesPage />
  </Frame>
)
const sheet = async () => within(await body().findByRole('dialog'))
const panelOf = async (view: ReturnType<typeof within>) =>
  within(await view.findByRole('region', { name: 'Approval' }))

// Settings

/** The policies come in two groups: Sales (invoices … quotes) and Spending (expenses). */
export const SettingsGrouped: Story = {
  render: () => (
    <Frame>
      <ApprovalsSettings />
    </Frame>
  ),
  parameters: pageParameters('/settings/approvals', {}, [business, ...approvalHandlers]),
  beforeEach: () => resetApprovals(configuredApprovals()),
  play: async () => {
    const sales = within(await body().findByRole('region', { name: 'Sales' }))
    await expect(sales.getByRole('region', { name: 'Invoices' })).toBeVisible()
    const quotesPolicy = within(sales.getByRole('region', { name: 'Quotes' }))
    await expect(quotesPolicy.getByRole('switch')).toBeChecked()
    await expect(quotesPolicy.getByRole('status', { name: 'Summary' })).toHaveTextContent(
      '1 person from Management must approve.',
    )
    const spending = within(body().getByRole('region', { name: 'Spending' }))
    const expensesPolicy = within(spending.getByRole('region', { name: 'Expenses' }))
    await expect(
      expensesPolicy.getByRole('textbox', { name: /^Only when the total is at least/ }),
    ).toHaveValue('500.00')
    await expect(spending.queryByRole('region', { name: 'Invoices' })).toBeNull()
  },
}
export const SettingsGroupedDark = dark(SettingsGrouped)
export const SettingsGroupedPhone = phone(SettingsGrouped)

// The quote drawer

/** Required, not submitted: Submit replaces Send; submitting makes it pending and Send waits. */
export const QuoteSubmit: Story = {
  render: quotes,
  parameters: quotesPage({ id: QUOTE }),
  beforeEach: () => resetApprovals({ byDoc: { [QUOTE]: approvalOf('none') } }),
  play: async () => {
    const view = await sheet()
    const panel = await panelOf(view)
    await expect(panel.getByText(/This quote needs approval before it can be sent/)).toBeVisible()
    await userEvent.click(view.getByRole('button', { name: 'More actions' }))
    await expect(body().queryByRole('menuitem', { name: 'Send' })).toBeNull()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(await view.findByRole('button', { name: 'Submit for approval' }))
    await expect(await body().findByText('Submitted for approval')).toBeInTheDocument()
    await expect(await view.findByText('Pending approval')).toBeVisible()
    const send = view.getByRole('button', { name: 'Send' })
    await expect(send).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(send)
    await expect(await body().findByRole('tooltip')).toHaveTextContent(
      'Waiting for approval. You can send it once it’s approved.',
    )
  },
}
export const QuoteSubmitDark = dark(QuoteSubmit)
export const QuoteSubmitPhone = phone(QuoteSubmit)

/** Pending, and I may approve: once the rule holds, Send is the main action again. */
export const QuotePendingAsApprover: Story = {
  render: quotes,
  parameters: quotesPage({ id: QUOTE }),
  beforeEach: () =>
    resetApprovals({
      byDoc: {
        [QUOTE]: approvalOf('pending', { can_decide: true }, [{ group_id: null, min: 1 }]),
      },
    }),
  play: async () => {
    const view = await sheet()
    const panel = await panelOf(view)
    await expect(panel.getByRole('button', { name: 'Request changes' })).toBeVisible()
    await userEvent.click(panel.getByRole('button', { name: 'Approve' }))
    await expect(await panel.findByText('Approved. It’s ready to send.')).toBeVisible()
    const send = await view.findByRole('button', { name: 'Send' })
    await expect(send).not.toHaveAttribute('aria-disabled')
  },
}

/** The list shows a draft's approval beside its status. */
export const QuoteListChip: Story = {
  render: quotes,
  parameters: quotesPage(),
  beforeEach: () =>
    resetQuotesMock([sampleQuote({ id: QUOTE, approval_state: 'pending' }), sampleQuote()]),
  play: async () => {
    await expect((await body().findAllByText('Pending approval'))[0]).toBeVisible()
  },
}

/** "Needs my approval" on the quotes page: a quote opens here, an expense goes to its own page. */
export const QuoteInbox: Story = {
  render: quotes,
  parameters: quotesPage(),
  beforeEach: () =>
    resetApprovals({
      items: [
        inboxItem({ doc_type: 'quote', doc_id: QUOTE, kind: 'quote' }),
        inboxItem({
          doc_type: 'expense',
          doc_id: EXPENSE,
          kind: 'expense',
          client_name: 'Digitec Galaxus AG',
          total: '1890.00',
          issue_date: '',
        }),
      ],
    }),
  play: async () => {
    const band = within(await body().findByRole('region', { name: 'Needs my approval' }))
    await expect(band.getByText(/Quote · from Luca Rossi/)).toBeVisible()
    await expect(band.getByText(/Expense · from Luca Rossi/)).toBeVisible()
    await userEvent.click(band.getByRole('button', { name: /Alpenglow Studio GmbH/ }))
    await waitFor(() => expect(window.location.search).toContain(`id=${QUOTE}`))
  },
}

// The expense drawer

/** Required, not submitted: Submit replaces Book; submitting makes it pending and Book waits. */
export const ExpenseSubmit: Story = {
  render: expenses,
  parameters: expensesPage({ id: EXPENSE }),
  beforeEach: () => resetApprovals({ byDoc: { [EXPENSE]: approvalOf('none') } }),
  play: async () => {
    const view = await sheet()
    const panel = await panelOf(view)
    await expect(
      panel.getByText(/This expense needs approval before it can be booked/),
    ).toBeVisible()
    await userEvent.click(await view.findByRole('button', { name: 'Submit for approval' }))
    await expect(await body().findByText('Submitted for approval')).toBeInTheDocument()
    await expect(await view.findByText('Pending approval')).toBeVisible()
    const book = view.getByRole('button', { name: 'Book' })
    await expect(book).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(book)
    await expect(await body().findByRole('tooltip')).toHaveTextContent(
      'Waiting for approval. You can book it once it’s approved.',
    )
  },
}
export const ExpenseSubmitDark = dark(ExpenseSubmit)
export const ExpenseSubmitPhone = phone(ExpenseSubmit)

/** Pending, and I may decide: requesting changes needs a comment, which the author reads. */
export const ExpenseRejectAsApprover: Story = {
  render: expenses,
  parameters: expensesPage({ id: EXPENSE }),
  beforeEach: () =>
    resetApprovals({ byDoc: { [EXPENSE]: approvalOf('pending', { can_decide: true }) } }),
  play: async () => {
    const view = await sheet()
    const panel = await panelOf(view)
    await expect(panel.getByRole('button', { name: 'Approve' })).toBeVisible()
    await userEvent.click(panel.getByRole('button', { name: 'Request changes' }))
    const dialog = within(await body().findByRole('dialog', { name: 'Request changes' }))
    await userEvent.type(dialog.getByLabelText(/What needs to change/), 'Attach the invoice.')
    await userEvent.click(dialog.getByRole('button', { name: 'Send back' }))
    await expect(await panel.findByText('Changes requested by Anna Muster')).toBeVisible()
    await expect(panel.getByTestId('approval-reason')).toHaveTextContent('Attach the invoice.')
  },
}

/** The server still asks for approval on booking (a policy switched on meanwhile): the toast says what to do. */
export const ExpenseBookNeedsApproval: Story = {
  render: expenses,
  parameters: expensesPage({ id: EXPENSE }, approvalRequired(`/api/v1/expenses/${EXPENSE}/book`)),
  play: async () => {
    const view = await sheet()
    const book = await view.findByRole('button', { name: 'Book' })
    await userEvent.click(book)
    await expect(await body().findByText('This draft needs approval first')).toBeInTheDocument()
    await expect(
      body().getByText(
        'Submit it for approval from its details; you can book it once it’s approved.',
      ),
    ).toBeInTheDocument()
  },
}

/** The list shows a draft's approval beside its status. */
export const ExpenseListChip: Story = {
  render: expenses,
  parameters: expensesPage(),
  beforeEach: () => resetApprovals({ byDoc: { [EXPENSE]: approvalOf('approved') } }),
  play: async () => {
    await expect((await body().findAllByText('Approved'))[0]).toBeVisible()
  },
}

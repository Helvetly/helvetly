import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AccountSettings } from '@/components/account/account-settings'
import { billingFixture } from '@/components/billing/billing-fixture'
import { PlanCards } from '@/components/billing/plan-cards'
import { ClientsPage } from '@/components/clients/clients-page'
import { Dashboard } from '@/components/dashboard/dashboard'
import { DocumentsPage } from '@/components/documents/documents-page'
import { Preview, type PreviewCommands } from '@/components/documents/preview'
import { TrashView } from '@/components/documents/trash-view'
import { EngagementsPage } from '@/components/engagements/engagements-page'
import { ExpensesPage } from '@/components/expenses/expenses-page'
import { InvoicesPage } from '@/components/invoices/invoices-page'
import { ProductsPage } from '@/components/products/products-page'
import { GeneralCard } from '@/components/settings/workspace-settings'
import type { DocFile } from '@/lib/documents'
import { listItem, sampleInvoice, sampleSettings } from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

import {
  emptyPage,
  screenHandlers,
  sessionHandler,
  storySession,
  unavailable,
} from './screen-fixtures'

const meta = {
  title: 'Domain screens/Workspace',
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    nextjs: { navigation: { pathname: '/documents' } },
    msw: { handlers: screenHandlers },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const DocumentsEmpty: Story = {
  render: () => <DocumentsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('Your documents live here')).toBeVisible())
    await Promise.all(
      canvas
        .getAllByRole('button', { name: 'Upload' })
        .map((button) => expect(button).toBeEnabled()),
    )
    await Promise.all(
      canvas
        .getAllByRole('button', { name: 'New folder' })
        .map((button) => expect(button).toBeEnabled()),
    )
  },
}
export const DocumentsLoading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/documents/folders', async () => {
          await delay('infinite')
          return HttpResponse.json({ data: [] })
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <DocumentsPage />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByRole('status', { name: 'Loading folders' })).toBeVisible(),
    )
  },
}
export const DocumentsUnavailable: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/v1/documents', unavailable), ...screenHandlers] },
  },
  render: () => <DocumentsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('can’t be loaded right now')
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeEnabled()
  },
}
export const EngagementsEmpty: Story = {
  parameters: { nextjs: { navigation: { pathname: '/engagements' } } },
  render: () => <EngagementsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('No engagements yet')).toBeVisible())
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search engagements' }), 'missing')
    await waitFor(() => expect(canvas.getByText('Nothing matches “missing”')).toBeVisible())
    await userEvent.click(canvas.getByRole('button', { name: 'Show all engagements' }))
    await expect(canvas.getByRole('searchbox')).toHaveValue('')
  },
}
export const EngagementsUnavailable: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/engagements' } },
    msw: { handlers: [http.get('/api/v1/engagements', unavailable), ...screenHandlers] },
  },
  render: () => <EngagementsPage />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'can’t be loaded right now',
    )
  },
}

const savedWorkspace = fn()
export const WorkspaceOwner: Story = {
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/v1/workspace', async ({ request }) => {
          const body: unknown = await request.json()
          savedWorkspace(body)
          return HttpResponse.json({ data: storySession.workspace })
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <GeneralCard name="Muster AG" timezone="Europe/Zurich" membershipRole="owner" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Save' })).toBeNull()
    await userEvent.clear(canvas.getByLabelText(/^Workspace name\*?$/))
    await userEvent.type(canvas.getByLabelText(/^Workspace name\*?$/), 'Muster GmbH')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedWorkspace).toHaveBeenCalledWith({ name: 'Muster GmbH' }))
    await expect(await canvas.findByText('Saved')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled()
  },
}
export const WorkspaceAdmin: Story = {
  render: () => <GeneralCard name="Muster AG" timezone="Europe/Zurich" membershipRole="admin" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText(/^Workspace name\*?$/)).toBeDisabled()
    await expect(canvas.getByLabelText(/^Time zone\*?$/)).toBeEnabled()
  },
}
export const WorkspaceMember: Story = {
  render: () => <GeneralCard name="Muster AG" timezone="Europe/Zurich" membershipRole="member" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText(/^Workspace name\*?$/)).toBeDisabled()
    await expect(canvas.getByLabelText(/^Time zone\*?$/)).toBeDisabled()
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  },
}
export const WorkspaceSaveFailure: Story = {
  parameters: {
    msw: { handlers: [http.patch('/api/v1/workspace', unavailable), ...screenHandlers] },
  },
  render: () => (
    <>
      <GeneralCard name="Muster AG" timezone="Europe/Zurich" membershipRole="owner" />
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/^Workspace name\*?$/), ' Zurich')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(
      await within(document.body).findByText('The service is temporarily unavailable.'),
    ).toBeInTheDocument() // the toast
    // The edit stays, still unsaved, ready for another try.
    await expect(canvas.getByLabelText(/^Workspace name\*?$/)).toHaveValue('Muster AG Zurich')
    await expect(canvas.getByText('Unsaved changes')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled()
  },
}

const savedProfile = fn()
const accountHandlers = [
  http.get('/api/v1/account', () =>
    HttpResponse.json({
      data: {
        identities: [
          { provider: 'email', email: storySession.user.email, created_at: '2026-11-01T00:00:00Z' },
        ],
        two_factor: { enabled: false, recovery_codes_left: 0 },
      },
    }),
  ),
  http.get('/api/v1/account/sessions', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/account/tokens', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/account/passkeys', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/auth/config', () =>
    HttpResponse.json({ google: true, email: true, passkey: true, dev_codes: false }),
  ),
  http.patch('/api/v1/account', async ({ request }) => {
    const body: unknown = await request.json()
    savedProfile(body)
    return HttpResponse.json({ data: { ...storySession.user, name: 'Anna Muster Zurich' } })
  }),
]
export const AccountProfile: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/account' } },
    msw: { handlers: [...accountHandlers, ...screenHandlers] },
  },
  render: () => <AccountSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const profile = await canvas.findByRole('region', { name: 'Profile' })
    await expect(within(profile).getByLabelText('Email')).toBeDisabled()
    await userEvent.type(within(profile).getByLabelText(/^Full name\*?$/), ' Zurich')
    await userEvent.click(within(profile).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedProfile).toHaveBeenCalledWith({ name: 'Anna Muster Zurich' }))
    await Promise.all(
      ['Sign-in methods', 'Two-factor authentication', 'Active sessions', 'Danger zone'].map(
        async (name) => expect(await canvas.findByRole('region', { name })).toBeVisible(),
      ),
    )
  },
}

export const BillingPeriod: Story = {
  render: () => <PlanCards billing={billingFixture()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Yearly' }))
    await expect(canvas.getByRole('radio', { name: 'Yearly' })).toBeChecked()
    await expect(canvas.getByRole('region', { name: 'Basic' })).toHaveTextContent('CHF 183')
    await expect(canvas.getByRole('region', { name: 'Pro' })).toHaveTextContent(
      '7 days, up to 2 people, card required',
    )
  },
}
export const BillingReadOnly: Story = {
  render: () => <PlanCards billing={billingFixture({ can_manage: false })} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Only an owner or admin can change the workspace’s plan.'),
    ).toBeVisible()
    await Promise.all(
      ['Choose Basic', 'Choose Business', /Start.*free trial/].map((name) =>
        expect(canvas.getByRole('button', { name })).toBeDisabled(),
      ),
    )
  },
}
export const BillingCancelChange: Story = {
  render: () => (
    <PlanCards billing={billingFixture({ plan: 'basic', interval: 'month', status: 'active' })} />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Upgrade to Pro' }))
    const body = within(document.body)
    await waitFor(() => expect(body.getByRole('dialog', { name: 'Upgrade to Pro?' })).toBeVisible())
    await userEvent.click(body.getByRole('button', { name: 'Not now' }))
    await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
  },
}
export const DashboardEmpty: Story = {
  parameters: { nextjs: { navigation: { pathname: '/' } } },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Nothing open. Every invoice is paid.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'New invoice' })).toBeEnabled()
    await expect(canvas.getByText('none fully paid yet')).toBeVisible()
  },
}
export const DashboardReadOnly: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/' } },
    msw: { handlers: [sessionHandler({ role: 'member', scopes: ['read:*'] }), ...screenHandlers] },
  },
  render: () => <Dashboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Nothing open. Every invoice is paid.')
    await expect(canvas.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument()
  },
}

const storyDocument: DocFile = {
  id: 'doc_story',
  name: 'Service agreement.pdf',
  folder_id: null,
  folder: null,
  size: 2048,
  content_type: 'application/pdf',
  kind: 'pdf',
  sha256: '0'.repeat(64),
  previewable: true,
  links: [],
  retained_until: null,
  uploaded_by: storySession.user,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
}
export const DocumentsSelection: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/documents', () =>
          HttpResponse.json({
            ...emptyPage,
            data: [storyDocument],
            meta: { ...emptyPage.meta, total: 1, total_pages: 1 },
          }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => <DocumentsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = await canvas.findByRole('checkbox', { name: 'Select Service agreement.pdf' })
    await userEvent.click(checkbox)
    await expect(canvas.getByRole('toolbar', { name: 'Selected rows' })).toHaveTextContent(
      'Selected: 1',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Clear selection' }))
    await expect(checkbox).not.toBeChecked()
  },
}
export const DocumentsReadOnly: Story = {
  parameters: {
    msw: {
      handlers: [sessionHandler({ role: 'member', scopes: ['read:documents'] }), ...screenHandlers],
    },
  },
  render: () => <DocumentsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Your documents live here')
    await Promise.all(
      ['Upload', 'Upload files', 'New folder'].map((name) =>
        expect(canvas.queryByRole('button', { name })).not.toBeInTheDocument(),
      ),
    )
  },
}
export const ClientsEmpty: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/clients' } },
    msw: {
      handlers: [
        http.get('/api/v1/clients', () => HttpResponse.json(emptyPage)),
        ...screenHandlers,
      ],
    },
  },
  render: () => <ClientsPage />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByText('No clients yet')).toBeVisible())
  },
}
export const ClientsLoading: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/clients' } },
    msw: {
      handlers: [
        http.get('/api/v1/clients', async () => {
          await delay('infinite')
          return HttpResponse.json(emptyPage)
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <ClientsPage />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByRole('status', { name: 'Loading' })).toBeVisible(),
    )
  },
}
export const ClientsUnavailable: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/clients' } },
    msw: { handlers: [http.get('/api/v1/clients', unavailable), ...screenHandlers] },
  },
  render: () => <ClientsPage />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText('Couldn’t load clients')).toBeVisible(),
    )
  },
}
export const ClientsReadOnly: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/clients' } },
    msw: {
      handlers: [
        sessionHandler({ role: 'member', scopes: ['read:clients'] }),
        http.get('/api/v1/clients', () => HttpResponse.json(emptyPage)),
        ...screenHandlers,
      ],
    },
  },
  render: () => <ClientsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('No clients yet')
    await expect(
      canvas.queryByRole('button', { name: 'Add your first client' }),
    ).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'New client' })).not.toBeInTheDocument()
  },
}
export const ClientsSelection: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/clients' } },
    msw: {
      handlers: [
        http.get('/api/v1/clients', () =>
          HttpResponse.json({
            ...emptyPage,
            data: [sampleClient()],
            meta: { ...emptyPage.meta, total: 1, total_pages: 1 },
          }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => <ClientsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = await canvas.findByRole('checkbox', { name: 'Select Alpenglow Studio GmbH' })
    await userEvent.click(checkbox)
    await expect(canvas.getByRole('toolbar', { name: 'Selected rows' })).toHaveTextContent(
      'Selected: 1',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Clear selection' }))
    await expect(checkbox).not.toBeChecked()
    await expect(canvas.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Next page' })).toBeDisabled()
  },
}
export const InvoicesEmpty: Story = {
  parameters: { nextjs: { navigation: { pathname: '/invoices' } } },
  render: () => <InvoicesPage />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByText('No invoices yet')).toBeVisible())
  },
}
export const InvoicesUnavailable: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/invoices' } },
    msw: { handlers: [http.get('/api/v1/invoices', unavailable), ...screenHandlers] },
  },
  render: () => <InvoicesPage />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText('Couldn’t load invoices')).toBeVisible(),
    )
  },
}
export const InvoicesReadOnly: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/invoices' } },
    msw: {
      handlers: [sessionHandler({ role: 'member', scopes: ['read:invoices'] }), ...screenHandlers],
    },
  },
  render: () => <InvoicesPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('No invoices yet')
    await expect(canvas.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument()
  },
}
export const InvoiceSelection: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/invoices' } },
    msw: {
      handlers: [
        http.get('/api/v1/invoices', () =>
          HttpResponse.json({
            ...emptyPage,
            data: [listItem(sampleInvoice())],
            meta: { ...emptyPage.meta, total: 1, total_pages: 1 },
          }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => <InvoicesPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('checkbox', { name: 'Select draft for Alpenglow Studio GmbH' }),
    )
    await expect(canvas.getByRole('toolbar', { name: 'Selected rows' })).toHaveTextContent(
      'Selected: 1',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Clear selection' }))
    await expect(canvas.queryByRole('toolbar')).not.toBeInTheDocument()
  },
}
export const EngagementsReadOnly: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/engagements' } },
    msw: {
      handlers: [
        sessionHandler({ role: 'member', scopes: ['read:engagements'] }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <EngagementsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('No engagements yet')
    await expect(canvas.queryByRole('button', { name: 'New engagement' })).not.toBeInTheDocument()
  },
}

export const ProductsReadOnly: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/products' } },
    msw: {
      handlers: [
        sessionHandler({ role: 'member', scopes: ['read:products'] }),
        http.get('/api/v1/products', () => HttpResponse.json(emptyPage)),
        http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
        ...screenHandlers,
      ],
    },
  },
  render: () => <ProductsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('No products or services yet')
    await expect(
      canvas.queryByRole('button', { name: 'Add product or service' }),
    ).not.toBeInTheDocument()
  },
}
const expenseSummary = {
  currency: 'CHF',
  this_month: { amount: '0.00', count: 0 },
  last_month: { amount: '0.00', count: 0 },
  unpaid: { amount: '0.00', count: 0 },
  overdue: { amount: '0.00', count: 0 },
  to_reimburse: { amount: '0.00', count: 0 },
  input_vat: { period: '2026-11', amount: '0.00' },
  incomplete: { count: 0 },
  by_category: [],
  monthly: [],
  views: { review: 0, unpaid: 0, reimburse: 0 },
}
export const ExpensesReadOnly: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/expenses' } },
    msw: {
      handlers: [
        sessionHandler({ role: 'member', scopes: ['read:expenses'] }),
        http.get('/api/v1/expenses', () => HttpResponse.json(emptyPage)),
        http.get('/api/v1/expenses/summary', () => HttpResponse.json({ data: expenseSummary })),
        http.get('/api/v1/expense-categories', () => HttpResponse.json({ data: [] })),
        ...screenHandlers,
      ],
    },
  },
  render: () => <ExpensesPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('No expenses yet')
    // The member's session can arrive after the list; until then the page shows every action.
    await waitFor(() => {
      for (const name of ['Add expense', 'Import receipts', 'New expense']) {
        expect(canvas.queryByRole('button', { name })).not.toBeInTheDocument()
      }
    })
  },
}

// A workspace without expenses: typing in the search never brings back the band of zero figures.
export const ExpensesEmptySearch: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/expenses', query: { q: 'sss' } } },
    msw: {
      handlers: [
        http.get('/api/v1/expenses', () => HttpResponse.json(emptyPage)),
        http.get('/api/v1/expenses/summary', () => HttpResponse.json({ data: expenseSummary })),
        http.get('/api/v1/expense-categories', () => HttpResponse.json({ data: [] })),
        ...screenHandlers,
      ],
    },
  },
  render: () => <ExpensesPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A search with no match: the list says so, and no figures for an empty workspace appear above it.
    await waitFor(() => expect(canvas.getByRole('searchbox')).toHaveValue('sss'))
    await waitFor(() => expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull())
    await expect(canvas.queryByText('Spent this month')).not.toBeInTheDocument()
  },
}

// Every list page's "…" menu leads with its import entry, with the same icon (Clients, Invoices, ... use "Import").
export const ExpensesImportMenu: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/expenses' } },
    msw: {
      handlers: [
        http.get('/api/v1/expenses', () => HttpResponse.json(emptyPage)),
        http.get('/api/v1/expenses/summary', () => HttpResponse.json({ data: expenseSummary })),
        http.get('/api/v1/expense-categories', () => HttpResponse.json({ data: [] })),
        ...screenHandlers,
      ],
    },
  },
  render: () => <ExpensesPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('No expenses yet')
    await userEvent.click(canvas.getByRole('button', { name: 'More' }))
    const items = await within(document.body).findAllByRole('menuitem')
    await expect(items[0]).toHaveTextContent('Import receipts')
    await expect(items[0]?.querySelector('svg.lucide-file-up')).not.toBeNull()
    // The open menu hides the page from the a11y check that runs after play.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('menu')).toBeNull())
  },
}
export const ExpensesImportMenuDark: Story = {
  ...ExpensesImportMenu,
  parameters: { ...ExpensesImportMenu.parameters, dark: true },
}

const previewCommands: PreviewCommands = {
  rename: fn(),
  move: fn(),
  copy: fn(),
  trash: fn(),
  restore: fn(),
  link: fn(),
  unlink: fn(),
  openFolder: fn(),
  sign: fn(),
}
export const DocumentsPreviewReadOnly: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler({ role: 'member', scopes: ['read:documents'] }),
        http.get('/api/v1/documents/doc_story', () =>
          HttpResponse.json({
            data: {
              ...storyDocument,
              kind: 'text',
              content_type: 'text/plain',
              previewable: false,
            },
          }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <Preview
      id="doc_story"
      siblings={[]}
      commands={previewCommands}
      onNavigate={fn()}
      onClose={fn()}
    />
  ),
  play: async () => {
    const body = within(document.body)
    await body.findByText('Service agreement.pdf')
    await waitFor(() =>
      expect(body.queryByRole('button', { name: 'More' })).not.toBeInTheDocument(),
    )
    await expect(body.queryByRole('button', { name: 'Client' })).not.toBeInTheDocument()
  },
}
export const TrashReadOnly: Story = {
  parameters: {
    msw: {
      handlers: [sessionHandler({ role: 'member', scopes: ['read:documents'] }), ...screenHandlers],
    },
  },
  render: () => (
    <TrashView
      items={[
        {
          type: 'file',
          id: 'doc_trash',
          name: 'Old receipt.pdf',
          content_type: 'application/pdf',
          size: 1234,
          item_count: 0,
          location: null,
          retained_until: null,
          deleted_at: '2026-11-01T00:00:00Z',
          deleted_by: null,
          purge_at: '2026-12-01T00:00:00Z',
        },
      ]}
      error={null}
      onRetry={fn()}
      selected={new Set()}
      onToggle={fn()}
      onToggleAll={fn()}
      onOpen={fn()}
      onRestore={fn()}
      onDelete={fn()}
      onEmpty={fn()}
      canDelete={false}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Old receipt.pdf')).toBeVisible()
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument(),
    )
  },
}
const documentWrite = fn()
export const DocumentsReadOnlyKeyboard: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler({ role: 'member', scopes: ['read:documents'] }),
        http.get('/api/v1/documents', () =>
          HttpResponse.json({ ...emptyPage, data: [storyDocument] }),
        ),
        http.post('/api/v1/documents/bulk', () => {
          documentWrite()
          return HttpResponse.json({ data: { updated: 1, skipped: [] } })
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <DocumentsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('checkbox', { name: 'Select Service agreement.pdf' }),
    )
    await expect(canvas.getByRole('toolbar', { name: 'Selected rows' })).toHaveTextContent(
      'Selected: 1',
    )
    await Promise.all(
      ['Move to…', 'Copy to…', 'Move to Trash'].map((name) =>
        expect(canvas.queryByRole('button', { name })).not.toBeInTheDocument(),
      ),
    )
    await userEvent.keyboard('{Delete}{F2}')
    await expect(documentWrite).not.toHaveBeenCalled()
    await expect(canvas.queryByRole('textbox', { name: /Rename/ })).not.toBeInTheDocument()
  },
}

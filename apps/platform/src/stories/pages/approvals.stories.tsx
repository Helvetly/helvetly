import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { InvoicesPage } from '@/components/invoices/invoices-page'
import { ApprovalsSettings } from '@/components/settings/approvals-settings'
import {
  accountants,
  approvalHandlers,
  approvalOf,
  approvalStateOf,
  configuredApprovals,
  inboxItem,
  resetApprovals,
} from '@/mocks/approvals'

import { storySession } from '../screen-fixtures'
import { draftInvoice } from './api'
import {
  closeHeidi,
  dark,
  desktop,
  expectCompactStacked,
  Frame,
  pageParameters,
  phone,
} from './frame'

const business = http.get('/api/v1/billing', () =>
  HttpResponse.json({
    data: billingFixture({ locked: false, plan: 'business', status: 'active' }),
  }),
)
// The draft's approval state follows the mock's request, as the API derives it.
const draft = http.get(`/api/v1/invoices/${draftInvoice.id}`, () =>
  HttpResponse.json({
    data: { ...draftInvoice, approval_state: approvalStateOf(draftInvoice.id) },
  }),
)

const settingsPage = (...handlers: RequestHandler[]) =>
  pageParameters('/settings/approvals', {}, [...handlers, business, ...approvalHandlers])
const drawer = (...handlers: RequestHandler[]) =>
  pageParameters('/invoices', { id: draftInvoice.id }, [
    ...handlers,
    business,
    draft,
    ...approvalHandlers,
  ])

const meta = {
  title: 'Pages/Approvals',
  beforeEach: () => {
    closeHeidi()
    resetApprovals()
  },
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj

const body = () => within(document.body)
const settings = () => (
  <Frame>
    <ApprovalsSettings />
  </Frame>
)
const invoices = () => (
  <Frame>
    <InvoicesPage />
  </Frame>
)
/** One document type's section of the settings. */
const policy = async (name: string) => within(await body().findByRole('region', { name }))
const sheet = async () => within(await body().findByRole('dialog', { name: /Draft|Invoice/ }))

// Settings

/** Nothing set up: create a group, switch invoices on and read the rule in words, then save. */
export const SettingsFirstSetup: Story = {
  render: settings,
  parameters: settingsPage(),
  play: async () => {
    await expect(await body().findByText('No approver groups yet')).toBeVisible()
    await userEvent.click(body().getByRole('button', { name: 'New group' }))
    const dialog = within(await body().findByRole('dialog', { name: 'New approver group' }))
    await userEvent.type(dialog.getByLabelText(/^Name/), 'Accountants')
    await userEvent.click(dialog.getByLabelText(/Luca Rossi/))
    await userEvent.click(dialog.getByLabelText(/Mia Keller/))
    await userEvent.click(dialog.getByRole('button', { name: 'Save group' }))
    await expect(await body().findByText('Luca Rossi and Mia Keller')).toBeVisible()
    await expect(await body().findByText('Group saved')).toBeInTheDocument()

    const invoicesPolicy = await policy('Invoices')
    await userEvent.click(invoicesPolicy.getByRole('switch'))
    // Switched on, it starts with the simplest rule; the next one takes the group.
    await expect(invoicesPolicy.getAllByTestId('approval-rule')).toHaveLength(1)
    await userEvent.click(invoicesPolicy.getByRole('button', { name: 'Add rule' }))
    await expect(invoicesPolicy.getAllByTestId('approval-rule')).toHaveLength(2)
    await expect(invoicesPolicy.getByRole('status', { name: 'Summary' })).toHaveTextContent(
      '1 person who can see invoices and 1 from Accountants must approve.',
    )
    await userEvent.click(invoicesPolicy.getByRole('button', { name: 'Save' }))
    await expect(await body().findByText('Approval for Invoices saved')).toBeInTheDocument()
  },
}
export const SettingsFirstSetupPhone = phone(SettingsFirstSetup)

/** Groups and policies in place: the rules in words, with the threshold; every source is offered once. */
export const SettingsConfigured: Story = {
  render: settings,
  parameters: settingsPage(),
  beforeEach: () => resetApprovals(configuredApprovals()),
  play: async () => {
    const invoicesPolicy = await policy('Invoices')
    await expect(invoicesPolicy.getByRole('switch')).toBeChecked()
    await expect(
      invoicesPolicy.getByRole('textbox', { name: /^Only when the total is at least/ }),
    ).toHaveValue('1’000.00')
    await expect(invoicesPolicy.getByRole('status', { name: 'Summary' })).toHaveTextContent(
      /2 people from Accountants and 1 from Management must approve\. The author never approves their own document\. Only documents of 1’000\.00 or more need approval\./,
    )
    await userEvent.click(invoicesPolicy.getByRole('button', { name: 'Add rule' }))
    await expect(invoicesPolicy.getByRole('status', { name: 'Summary' })).toHaveTextContent(
      /and 1 more person must approve/,
    )
    // Both groups and "anyone" have their rule: nothing is left to add.
    await expect(invoicesPolicy.getByRole('button', { name: 'Add rule' })).toBeDisabled()
    const creditNotes = await policy('Credit notes')
    await expect(creditNotes.getByRole('status', { name: 'Summary' })).toHaveTextContent(
      '1 person who can see invoices must approve.',
    )
    await expect((await policy('Debit notes')).getByRole('switch')).not.toBeChecked()
  },
}
export const SettingsConfiguredDark = dark(SettingsConfigured)
export const SettingsConfiguredPhone = phone(SettingsConfigured)

/** The form says what is wrong before asking the server: no rule left, a threshold that is no amount. */
export const SettingsValidation: Story = {
  render: settings,
  parameters: settingsPage(),
  beforeEach: () => resetApprovals(configuredApprovals()),
  play: async () => {
    const creditNotes = await policy('Credit notes')
    await userEvent.click(creditNotes.getByRole('button', { name: 'Remove rule' }))
    await userEvent.click(creditNotes.getByRole('button', { name: 'Save' }))
    await expect(await creditNotes.findByRole('alert')).toHaveTextContent('Add at least one rule.')

    const invoicesPolicy = await policy('Invoices')
    const threshold = invoicesPolicy.getByRole('textbox', {
      name: /^Only when the total is at least/,
    })
    await userEvent.clear(threshold)
    await userEvent.type(threshold, 'abc')
    await userEvent.click(invoicesPolicy.getByRole('button', { name: 'Save' }))
    await expect(
      await invoicesPolicy.findByText('Enter an amount above 0, e.g. 1000.'),
    ).toBeVisible()
  },
}

/** The server refuses a rule (its group went away meanwhile): the message lands on that rule. */
export const SettingsRefusedByServer: Story = {
  render: settings,
  parameters: settingsPage(
    http.put('/api/v1/approvals/policies/invoice', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the fields.',
            details: { fields: { 'rules.0.group_id': 'This group no longer exists.' } },
          },
        },
        { status: 422 },
      ),
    ),
  ),
  beforeEach: () => resetApprovals(configuredApprovals()),
  play: async () => {
    const invoicesPolicy = await policy('Invoices')
    const threshold = invoicesPolicy.getByRole('textbox', {
      name: /^Only when the total is at least/,
    })
    await userEvent.clear(threshold)
    await userEvent.type(threshold, '2000')
    await userEvent.click(invoicesPolicy.getByRole('button', { name: 'Save' }))
    await expect(await invoicesPolicy.findByText('This group no longer exists.')).toBeVisible()
  },
}

/** A second group of the same name is refused in the dialog, next to the name. */
export const SettingsGroupNameTaken: Story = {
  render: settings,
  parameters: settingsPage(),
  beforeEach: () => resetApprovals(configuredApprovals()),
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'New group' }))
    const dialog = within(await body().findByRole('dialog', { name: 'New approver group' }))
    await userEvent.type(dialog.getByLabelText(/^Name/), 'accountants')
    await userEvent.click(dialog.getByRole('button', { name: 'Save group' }))
    await expect(await dialog.findByText('A group with this name already exists.')).toBeVisible()
  },
}

/** A group a rule uses is not deleted: the toast says where it is used. Rename works from the same row. */
export const SettingsGroupInUse: Story = {
  render: settings,
  parameters: settingsPage(),
  beforeEach: () => resetApprovals(configuredApprovals()),
  play: async () => {
    const remove = await body().findByRole('button', { name: `Delete ${accountants.name}` })
    await userEvent.hover(remove)
    await expect(await body().findByRole('tooltip')).toHaveTextContent('Delete group')
    await userEvent.click(remove)
    const confirm = within(await body().findByRole('dialog', { name: 'Delete Accountants?' }))
    await userEvent.click(confirm.getByRole('button', { name: 'Delete group' }))
    await expect(
      await body().findByText('Accountants is used in a rule. Remove it from the rules first.'),
    ).toBeInTheDocument()
    const groups = within(body().getByRole('region', { name: 'Approver groups' }))
    await expect(groups.getByText('Accountants')).toBeVisible()

    await userEvent.click(body().getByRole('button', { name: `Edit ${accountants.name}` }))
    const dialog = within(await body().findByRole('dialog', { name: 'Edit approver group' }))
    const name = dialog.getByLabelText(/^Name/)
    await userEvent.clear(name)
    await userEvent.type(name, 'Finance')
    await userEvent.click(dialog.getByRole('button', { name: 'Save group' }))
    await expect(await groups.findByText('Finance')).toBeVisible()
  },
}

/** On a plan without approvals the page invites to the plan that has them. */
export const SettingsPlanWithoutFeature: Story = {
  render: settings,
  // The shell's own billing is Pro.
  parameters: pageParameters('/settings/approvals', {}, approvalHandlers),
  play: async () => {
    const card = within(
      await body().findByRole('region', { name: 'Approve documents before they go out' }),
    )
    await expect(card.getByRole('link', { name: 'Upgrade to Business' })).toBeVisible()
    await expectCompactStacked(card.getByText(/Approver groups such as/))
    await expect(body().queryByRole('region', { name: 'Invoices' })).toBeNull()
  },
}
export const SettingsPlanWithoutFeatureDark = dark(SettingsPlanWithoutFeature)

/** A member (even with full access) neither sees the tab nor the settings. */
export const SettingsMember: Story = {
  render: settings,
  parameters: settingsPage(
    http.get('/api/v1/session', () =>
      HttpResponse.json({ ...storySession, role: 'member', scopes: ['*:*'] }),
    ),
  ),
  play: async () => {
    await expect(await body().findByText('Only owners and admins set up approvals')).toBeVisible()
    await expect(body().queryByRole('button', { name: 'Approvals' })).toBeNull()
  },
}

// The invoice drawer

/** No policy for invoices: the drawer is as before, Issue is the main action. */
export const DrawerNotRequired: Story = {
  render: invoices,
  parameters: drawer(),
  play: async () => {
    const drawerView = await sheet()
    const issue = await drawerView.findByRole('button', { name: 'Issue' })
    // Disabled only until the draft's approval is known.
    await waitFor(() => expect(issue).toBeEnabled())
    await expect(drawerView.queryByRole('region', { name: 'Approval' })).toBeNull()
    await expect(drawerView.queryByText('Approval')).toBeNull()
  },
}

/** Required, not submitted: Submit replaces Issue, which leaves the menu; submitting makes it pending. */
export const DrawerSubmit: Story = {
  render: invoices,
  parameters: drawer(),
  beforeEach: () => resetApprovals({ byInvoice: { [draftInvoice.id]: approvalOf('none') } }),
  play: async () => {
    const drawerView = await sheet()
    const panel = within(await drawerView.findByRole('region', { name: 'Approval' }))
    await expect(panel.getByText(/This draft needs approval before it can be issued/)).toBeVisible()
    await expect(panel.getByText('Accountants')).toBeVisible()
    await expect(panel.getByText('0/2')).toBeVisible()
    // The step row: Created → Approval → Issued.
    await expect(drawerView.getAllByText('Approval').length).toBeGreaterThan(0)
    await userEvent.click(drawerView.getByRole('button', { name: 'More actions' }))
    await expect(body().queryByRole('menuitem', { name: 'Issue' })).toBeNull()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(await drawerView.findByRole('button', { name: 'Submit for approval' }))
    await expect(await body().findByText('Submitted for approval')).toBeInTheDocument()
    await expect(await drawerView.findByText('Pending approval')).toBeVisible()
    await expect(await panel.findByText('Anna Muster submitted it for approval')).toBeVisible()
    const issue = drawerView.getByRole('button', { name: 'Issue' })
    await expect(issue).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(issue)
    await expect(await body().findByRole('tooltip')).toHaveTextContent(/Waiting for approval/)
  },
}
export const DrawerSubmitDark = dark(DrawerSubmit)
export const DrawerSubmitPhone = phone(DrawerSubmit)

/** Pending, and I may approve: my approval fills one slot and the rest still waits. */
export const DrawerPendingAsApprover: Story = {
  render: invoices,
  parameters: drawer(),
  beforeEach: () =>
    resetApprovals({
      byInvoice: { [draftInvoice.id]: approvalOf('pending', { can_decide: true }) },
    }),
  play: async () => {
    const drawerView = await sheet()
    const panel = within(await drawerView.findByRole('region', { name: 'Approval' }))
    await expect(panel.getByText('Luca Rossi submitted it for approval')).toBeVisible()
    await userEvent.click(panel.getByRole('button', { name: 'Approve' }))
    await expect(await body().findByText('Approved')).toBeInTheDocument()
    await expect(await panel.findByText('1/2')).toBeVisible()
    await expect(panel.getByText('Anna Muster approved')).toBeVisible()
    await expect(panel.queryByRole('button', { name: 'Approve' })).toBeNull()
  },
}
export const DrawerPendingAsApproverPhone = phone(DrawerPendingAsApprover)

/** Requesting changes needs a comment; the author then reads it on the draft. */
export const DrawerRejectWithComment: Story = {
  render: invoices,
  parameters: drawer(),
  beforeEach: () =>
    resetApprovals({
      byInvoice: { [draftInvoice.id]: approvalOf('pending', { can_decide: true }) },
    }),
  play: async () => {
    const drawerView = await sheet()
    const panel = within(await drawerView.findByRole('region', { name: 'Approval' }))
    await userEvent.click(panel.getByRole('button', { name: 'Request changes' }))
    const dialog = within(await body().findByRole('dialog', { name: 'Request changes' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Send back' }))
    await expect(await dialog.findByText('Say what needs to change.')).toBeVisible()
    await userEvent.type(
      dialog.getByLabelText(/What needs to change/),
      'The hourly rate should be 150.',
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Send back' }))
    await expect(await panel.findByText('Changes requested by Anna Muster')).toBeVisible()
    await expect(panel.getByTestId('approval-reason')).toHaveTextContent(
      'The hourly rate should be 150.',
    )
    await expect(await drawerView.findByText('Changes requested')).toBeVisible()
  },
}

/** Pending, and I submitted it: Issue waits (its tooltip says why); I can withdraw. */
export const DrawerPendingAsAuthor: Story = {
  render: invoices,
  parameters: drawer(),
  beforeEach: () =>
    resetApprovals({
      byInvoice: { [draftInvoice.id]: approvalOf('pending', { can_withdraw: true }) },
    }),
  play: async () => {
    const drawerView = await sheet()
    const panel = within(await drawerView.findByRole('region', { name: 'Approval' }))
    const issue = drawerView.getByRole('button', { name: 'Issue' })
    await expect(issue).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(issue)
    await expect(await body().findByRole('tooltip')).toHaveTextContent(/Waiting for approval/)
    await expect(drawerView.queryByRole('button', { name: 'Approve' })).toBeNull()
    await userEvent.click(panel.getByRole('button', { name: 'Withdraw request' }))
    await expect(await body().findByText('Request withdrawn')).toBeInTheDocument()
    await expect(
      await drawerView.findByRole('button', { name: 'Submit for approval' }),
    ).toBeVisible()
  },
}

/** Approved: the step is done and Issue is the main action again. */
export const DrawerApproved: Story = {
  render: invoices,
  parameters: drawer(),
  beforeEach: () =>
    resetApprovals({
      byInvoice: {
        [draftInvoice.id]: approvalOf('approved', {
          trail: [
            {
              kind: 'submitted',
              user: { id: 'usr_2', name: 'Luca Rossi' },
              at: '2026-11-18T09:12:00Z',
              comment: null,
            },
            {
              kind: 'approved',
              user: { id: 'usr_story', name: 'Anna Muster' },
              at: '2026-11-19T10:00:00Z',
              comment: 'Looks right.',
            },
          ],
        }),
      },
    }),
  play: async () => {
    const drawerView = await sheet()
    const panel = within(await drawerView.findByRole('region', { name: 'Approval' }))
    await expect(panel.getByText('Approved. It’s ready to issue.')).toBeVisible()
    await expect(panel.getByText('Looks right.')).toBeVisible()
    await expect(await drawerView.findByRole('button', { name: 'Issue' })).toBeEnabled()
    await expect(drawerView.getByRole('button', { name: 'Issue' })).not.toHaveAttribute(
      'aria-disabled',
    )
  },
}
export const DrawerApprovedDark = dark(DrawerApproved)

/** Changes requested: the reason and who asked, and Submit for approval again. */
export const DrawerRejected: Story = {
  render: invoices,
  parameters: drawer(),
  beforeEach: () =>
    resetApprovals({
      byInvoice: {
        [draftInvoice.id]: approvalOf('rejected', {
          comment: 'Please split the workshop into two lines.',
          trail: [
            {
              kind: 'submitted',
              user: { id: 'usr_story', name: 'Anna Muster' },
              at: '2026-11-18T09:12:00Z',
              comment: null,
            },
            {
              kind: 'rejected',
              user: { id: 'usr_2', name: 'Luca Rossi' },
              at: '2026-11-18T11:40:00Z',
              comment: 'Please split the workshop into two lines.',
            },
          ],
        }),
      },
    }),
  play: async () => {
    const drawerView = await sheet()
    const panel = within(await drawerView.findByRole('region', { name: 'Approval' }))
    await expect(panel.getByText('Changes requested by Luca Rossi')).toBeVisible()
    await expect(panel.getByText('Luca Rossi asked for changes')).toBeVisible()
    await expect(panel.getByTestId('approval-reason')).toHaveTextContent(
      'Please split the workshop into two lines.',
    )
    await expect(panel.getByText('Edit the draft, then submit it again.')).toBeVisible()
    await expect(drawerView.getByRole('button', { name: 'Submit for approval' })).toBeVisible()
  },
}
export const DrawerRejectedPhone = phone(DrawerRejected)

/** The server still asks for approval on issue (a policy switched on meanwhile): the toast says what to do. */
export const DrawerIssueNeedsApproval: Story = {
  render: invoices,
  parameters: drawer(
    http.post(`/api/v1/invoices/${draftInvoice.id}/issue`, () =>
      HttpResponse.json(
        {
          error: {
            code: 'approval_required',
            message: 'This document needs approval before it can be issued.',
          },
        },
        { status: 409 },
      ),
    ),
  ),
  play: async () => {
    const drawerView = await sheet()
    const issue = await drawerView.findByRole('button', { name: 'Issue' })
    await waitFor(() => expect(issue).toBeEnabled())
    await userEvent.click(issue)
    const confirm = within(await body().findByRole('dialog', { name: /^Issue this/ }))
    await userEvent.click(confirm.getByRole('button', { name: 'Issue' }))
    await expect(await body().findByText('This draft needs approval first')).toBeInTheDocument()
    await expect(body().getByText(/Submit it for approval from its details/)).toBeInTheDocument()
  },
}

// "Needs my approval"

/** Nothing waits for me: no band. */
export const InboxEmpty: Story = {
  render: invoices,
  parameters: pageParameters('/invoices', {}, [business, ...approvalHandlers]),
  play: async () => {
    await body().findAllByText('Alpenglow Studio GmbH')
    await expect(body().queryByRole('region', { name: 'Needs my approval' })).toBeNull()
  },
}

/** Two documents wait for me: the band counts them, and a row opens its drawer to decide. */
export const InboxWithItems: Story = {
  render: invoices,
  parameters: pageParameters('/invoices', {}, [business, draft, ...approvalHandlers]),
  beforeEach: () =>
    resetApprovals({
      items: [
        inboxItem(),
        inboxItem({
          doc_id: 'inv_other',
          doc_type: 'credit_note',
          kind: 'credit_note',
          client_name: 'Bergbahn Arosa AG',
          total: '420.00',
        }),
      ],
      byInvoice: { [draftInvoice.id]: approvalOf('pending', { can_decide: true }) },
    }),
  play: async () => {
    const band = within(await body().findByRole('region', { name: 'Needs my approval' }))
    await expect(band.getByText('2')).toBeVisible()
    await expect(band.getByText('Bergbahn Arosa AG')).toBeVisible()
    await expect(band.getByText(/Credit note · from Luca Rossi/)).toBeVisible()
    await userEvent.click(band.getByRole('button', { name: /Alpenglow Studio GmbH/ }))
    // The page keeps the open drawer in the URL (the stories' router does not follow it).
    await waitFor(() => expect(window.location.search).toContain(`id=${draftInvoice.id}`))
  },
}
export const InboxWithItemsDark = dark(InboxWithItems)
export const InboxWithItemsPhone = phone(InboxWithItems)

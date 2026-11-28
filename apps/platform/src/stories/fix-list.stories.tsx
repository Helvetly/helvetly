import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IssueBlockersDialog } from '@/components/invoices/invoice-dialogs'
import { ExportBlockersDialog } from '@/components/settings/vat-return'
import type { Client } from '@/lib/clients'
import type { IssueReason } from '@/lib/invoices'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Flows/Fix before continuing',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const phone = {
  viewport: {
    options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
  },
}

const settings: IssueReason[] = [
  {
    code: 'settings_incomplete',
    field: 'settings.seller.zip',
    message: 'Complete the invoice settings: seller.zip.',
  },
  {
    code: 'settings_incomplete',
    field: 'settings.seller.city',
    message: 'Complete the invoice settings: seller.city.',
  },
  {
    code: 'seller_vat_missing',
    field: 'settings.seller.vat_number',
    message: "Add the seller's VAT number in the invoice settings, or issue without VAT.",
  },
  {
    code: 'no_iban',
    field: 'settings.iban',
    message: 'Add the IBAN payments go to in the invoice settings.',
  },
]
const many: IssueReason[] = [
  ...settings,
  {
    code: 'client_draft',
    field: 'client.address',
    message: "Complete the client's address: street, zip.",
  },
  {
    code: 'buyer_vat_missing',
    field: 'client.vat_number',
    message: "Reverse-charge and intra-community lines need the client's VAT number.",
  },
  { code: 'no_lines', field: 'lines', message: 'Add at least one line.' },
  {
    code: 'issue_date_future',
    field: 'issue_date',
    message: 'The issue date cannot be in the future.',
  },
]

/** The client the dialog's client row opens in place: its address is missing until saved. */
let keller: Client
const incomplete = () =>
  sampleClient({
    id: 'cli_2',
    name: 'Keller Holzbau AG',
    street: null,
    street_number: null,
    is_draft: true,
    missing_fields: ['street', 'street_number'],
  })
const clientHandlers = [
  sessionHandler(),
  http.get('/api/v1/clients/tags', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/clients/cli_2', () => HttpResponse.json({ data: keller })),
  http.patch<never, Partial<Client>>('/api/v1/clients/cli_2', async ({ request }) => {
    keller = { ...keller, ...(await request.json()), is_draft: false, missing_fields: [] }
    return HttpResponse.json({ data: keller })
  }),
]

const issueDialog = (reasons: IssueReason[]) => (
  <IssueBlockersDialog
    reasons={reasons}
    clientId="cli_2"
    editHref="/invoices?compose=inv_1"
    onClose={() => {}}
  />
)

/** The dialog by its title, its list and the rows' fix links. */
async function blockers(rows: number) {
  const body = within(document.body)
  const found = await body.findByRole('dialog', { name: 'Not ready to issue yet' })
  // The dialog fades in.
  await waitFor(() => expect(found).toBeVisible())
  const list = within(found).getByRole('list')
  await expect(within(list).getAllByRole('listitem')).toHaveLength(rows)
  return { dialog: within(found), list: within(list) }
}

export const OneIssue: Story = {
  render: () => issueDialog([settings[3]!]),
  play: async () => {
    const { dialog, list } = await blockers(1)
    await expect(dialog.getByText('One thing to fix before issuing')).toBeVisible()
    await expect(list.getByRole('link', { name: /Bank details/ })).toHaveAttribute(
      'href',
      '/settings/company/?focus=iban#bank',
    )
  },
}

export const ThreeIssues: Story = {
  render: () => issueDialog(settings),
  play: async () => {
    const { dialog, list } = await blockers(3)
    await expect(dialog.getByText('3 things to fix before issuing')).toBeVisible()
    // Every row goes to its own section, so no two links read the same.
    await expect(list.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/settings/company/?focus=seller.zip#company',
      '/settings/company/?focus=seller.vat_number#vat',
      '/settings/company/?focus=iban#bank',
    ])
    await expect(list.getByText('Your company details are missing: ZIP, City.')).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Open in editor' })).toBeVisible()
  },
}

export const ManyIssues: Story = {
  parameters: { msw: { handlers: clientHandlers } },
  beforeEach: () => {
    keller = incomplete()
  },
  render: () => issueDialog(many),
  play: async () => {
    const { dialog, list } = await blockers(6)
    await expect(dialog.getByText('6 things to fix before issuing')).toBeVisible()
    // Both client problems are fixed in the client: one row, one action, which opens it in place.
    await expect(list.getAllByRole('button', { name: /Complete the client/ })).toHaveLength(1)
    await expect(list.getByText('Add at least one line.')).toBeVisible()
  },
}

/**
 * The client's address is fixed without leaving: its form opens over the dialog on the first missing field, and
 * saving returns to the dialog, ready to issue again.
 */
export const FixClientInPlace: Story = {
  parameters: { msw: { handlers: clientHandlers } },
  beforeEach: () => {
    keller = incomplete()
  },
  render: () => issueDialog([many[4]!]),
  play: async () => {
    const { list } = await blockers(1)
    await userEvent.click(list.getByRole('button', { name: /Complete the client/ }))
    const form = await within(document.body).findByRole('dialog', {
      name: 'Edit Keller Holzbau AG',
    })
    const street = within(form).getByRole('textbox', { name: 'Street' })
    await waitFor(() => expect(street).toHaveFocus())
    await userEvent.type(street, 'Holzweg')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Number' }), '4')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(form).not.toBeInTheDocument())
    await expect(keller.street).toBe('Holzweg')
    await expect(
      within(document.body).getByRole('dialog', { name: 'Not ready to issue yet' }),
    ).toBeVisible()
  },
}

export const ThreeIssuesDark: Story = { ...ThreeIssues, parameters: { dark: true } }
export const ManyIssuesDark: Story = { ...ManyIssues, parameters: { dark: true } }
export const ThreeIssuesMobile: Story = {
  ...ThreeIssues,
  parameters: phone,
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await ThreeIssues.play?.(context)
    const found = await within(document.body).findByRole('dialog')
    await expect(found.scrollWidth).toBeLessThanOrEqual(found.clientWidth)
  },
}
export const ManyIssuesMobileDark: Story = {
  ...ManyIssues,
  parameters: { ...phone, dark: true },
  globals: { viewport: { value: 'phone' } },
}

export const VATExportRefused: Story = {
  render: () => (
    <ExportBlockersDialog
      reasons={[
        {
          code: 'uid_missing',
          message:
            'Add your Swiss UID (CHE-…) as the VAT number in the invoice settings: the ESTV file is filed under it.',
        },
        {
          code: 'foreign_currency',
          message: 'Some invoices are in EUR: the ESTV file needs CHF figures.',
        },
      ]}
      onClose={() => {}}
    />
  ),
  play: async () => {
    const body = within(document.body)
    const element = await body.findByRole('dialog', { name: 'Can’t export the ESTV file yet' })
    await waitFor(() => expect(element).toBeVisible())
    const found = within(element)
    const list = within(found.getByRole('list'))
    await expect(list.getAllByRole('listitem')).toHaveLength(2)
    await expect(list.getByRole('link', { name: /VAT settings/ })).toHaveAttribute(
      'href',
      '/settings/company/?focus=seller.vat_number#vat',
    )
  },
}

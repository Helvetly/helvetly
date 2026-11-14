import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ClientContacts } from '@/components/clients/client-contacts'
import { InvoiceSettingsPage } from '@/components/settings/invoice-settings'
import type { ContactInput } from '@/lib/clients'
import type { SettingsInput } from '@/lib/invoices'
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

const meta = { title: 'Forms/Phone fields', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const saved: { settings: Partial<SettingsInput> | null; contact: Partial<ContactInput> | null } = {
  settings: null,
  contact: null,
}
// read through calls, so the reset in play does not narrow them to null
const savedSettings = () => saved.settings
const savedContact = () => saved.contact

/** The company phone opens in its national format, refuses an invalid number and saves E.164. */
export const CompanyPhone: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/session', () => HttpResponse.json(session)),
        http.get('/api/v1/invoice-settings', () =>
          HttpResponse.json({
            data: sampleSettings({ seller: { ...sampleSettings().seller, phone: '+41782390999' } }),
          }),
        ),
        http.put<never, Partial<SettingsInput>>('/api/v1/invoice-settings', async ({ request }) => {
          saved.settings = await request.json()
          return HttpResponse.json({ data: sampleSettings() })
        }),
      ],
    },
  },
  render: () => (
    <SidebarProvider>
      <InvoiceSettingsPage />
    </SidebarProvider>
  ),
  play: async ({ canvasElement }) => {
    saved.settings = null
    const page = within(canvasElement)
    const phone = await page.findByLabelText('Phone')
    await expect(phone).toHaveValue('078 239 09 99')
    await expect(page.getByRole('button', { name: 'Phone country CH +41' })).toBeVisible()
    await userEvent.clear(phone)
    await userEvent.type(phone, '123')
    await expect(await page.findByText('Enter a valid phone number.')).toBeVisible()
    await expect(phone).toHaveAttribute('aria-invalid', 'true')
    await userEvent.clear(phone)
    await userEvent.type(phone, '442244646')
    await expect(phone).toHaveValue('44 224 46 46')
    const company = within(page.getByRole('region', { name: 'Company' }))
    await userEvent.click(company.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedSettings()?.seller?.phone).toBe('+41442244646'))
  },
}

/** A contact's phone starts in the client's country and is saved as E.164. */
export const ContactPhone: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post<never, Partial<ContactInput>>(
          '/api/v1/clients/cli_1/contacts',
          async ({ request }) => {
            saved.contact = await request.json()
            return HttpResponse.json(
              {
                data: {
                  id: 'con_1',
                  name: 'Lena Huber',
                  role: null,
                  email: null,
                  phone: '+4930901820',
                  is_primary: true,
                },
              },
              { status: 201 },
            )
          },
        ),
      ],
    },
  },
  render: () => (
    <div className="max-w-xl p-6">
      <ClientContacts client={sampleClient({ country: 'DE' })} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    saved.contact = null
    const page = within(canvasElement)
    await userEvent.click(page.getByRole('button', { name: /add contact/i }))
    await expect(page.getByRole('button', { name: 'Phone country DE +49' })).toBeVisible()
    await userEvent.type(page.getByLabelText('Name'), 'Lena Huber')
    const phone = page.getByLabelText('Phone')
    await userEvent.type(phone, '12')
    await userEvent.click(page.getByRole('button', { name: 'Add contact' }))
    await expect(await page.findByText('Enter a valid phone number.')).toBeVisible()
    await userEvent.clear(phone)
    await userEvent.type(phone, '30 901820')
    await userEvent.click(page.getByRole('button', { name: 'Add contact' }))
    await waitFor(() => expect(savedContact()?.phone).toBe('+4930901820'))
  },
}

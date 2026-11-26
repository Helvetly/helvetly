import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ClientEmailsSettings } from '@/components/settings/client-emails'
import type { SettingsInput } from '@/lib/invoices'
import { clientEmailChanges, resetClientEmails } from '@/mocks/client-emails'
import { sampleSettings } from '@/test/invoice-api'

import { screenHandlers, sessionHandler } from './screen-fixtures'

const invoiceSaves: SettingsInput[] = []
const invoiceHandlers = [
  http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
  http.put<never, SettingsInput>('/api/v1/invoice-settings', async ({ request }) => {
    const change = await request.json()
    invoiceSaves.push(change)
    const settings = sampleSettings()
    return HttpResponse.json({
      data: {
        ...settings,
        ...change,
        instalments: { ...settings.instalments, ...change.instalments },
        dunning: { ...settings.dunning, ...change.dunning },
      },
    })
  }),
]

const meta = {
  title: 'Settings/Client emails',
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="flex min-w-0 flex-1 flex-col bg-card">
          <Story />
          <Toaster />
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    ownMain: true,
    nextjs: { navigation: { pathname: '/settings/emails' } },
    msw: { handlers: [...invoiceHandlers, ...screenHandlers] },
  },
  beforeEach: () => {
    resetClientEmails()
    invoiceSaves.length = 0
  },
  render: () => <ClientEmailsSettings />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/**
 * Every automatic email in one list: a switch saves at once where its setting lives (the invoice settings or the
 * workspace), sending only that field; the reminder rows link to their timing.
 */
export const Switches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = within(await canvas.findByRole('region', { name: 'Automatic emails' }))
    await expect(list.getAllByRole('switch')).toHaveLength(6)
    await expect(list.getByRole('link', { name: 'Reminder steps' })).toHaveAttribute(
      'href',
      '/settings/invoices/#dunning',
    )

    await userEvent.click(
      list.getByRole('switch', { name: 'Email clients a payment confirmation' }),
    )
    await waitFor(() => expect(invoiceSaves).toEqual([{ payment_confirmation: false }]))
    await expect(
      list.getByRole('switch', { name: 'Email clients a payment confirmation' }),
    ).not.toBeChecked()

    await userEvent.click(list.getByRole('switch', { name: 'Instalment reminders' }))
    await waitFor(() =>
      expect(invoiceSaves.at(-1)).toEqual({ instalments: { reminders_enabled: false } }),
    )

    await userEvent.click(list.getByRole('switch', { name: 'Portal invitations' }))
    await waitFor(() => expect(clientEmailChanges).toEqual([{ portal_invitations: false }]))
    await expect(list.getByRole('switch', { name: 'Portal invitations' })).not.toBeChecked()
    await expect(
      await within(document.body).findByText('Portal invitations: off.'),
    ).toBeInTheDocument()
  },
}

/** The footer: too many lines are refused before saving; a valid one is saved trimmed and previewed. */
export const Footer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const section = within(await canvas.findByRole('region', { name: 'Email footer' }))
    const field = section.getByRole('textbox', { name: 'Footer' })
    await userEvent.type(field, 'a{Enter}b{Enter}c{Enter}d{Enter}e')
    await userEvent.click(section.getByRole('button', { name: 'Save' }))
    await expect(
      await section.findByText('Enter at most 4 lines and 300 characters.'),
    ).toBeVisible()
    await expect(clientEmailChanges).toEqual([])

    await userEvent.clear(field)
    await userEvent.type(field, '  Office hours: Mon–Fri  {Enter}IBAN CH93 0076 2011 6238 5295 7')
    await expect(section.getByLabelText('Preview')).toHaveTextContent(
      'Office hours: Mon–Fri IBAN CH93',
    )
    await userEvent.click(section.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(clientEmailChanges).toEqual([
        { email_footer: 'Office hours: Mon–Fri\nIBAN CH93 0076 2011 6238 5295 7' },
      ]),
    )
    await expect(await within(document.body).findByText('Email footer saved.')).toBeInTheDocument()
  },
}

/** A member reads the settings but changes nothing: every switch and the footer say who can. */
export const ReadOnly: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler({ role: 'member', scopes: ['read:*'] }),
        ...invoiceHandlers,
        ...screenHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = within(await canvas.findByRole('region', { name: 'Automatic emails' }))
    await Promise.all(list.getAllByRole('switch').map((toggle) => expect(toggle).toBeDisabled()))
    await expect(canvas.getByRole('textbox', { name: 'Footer' })).toBeDisabled()
  },
}

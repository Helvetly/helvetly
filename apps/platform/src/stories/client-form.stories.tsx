import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientForm } from '@/components/clients/client-form'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Clients/Client form',
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/clients/tags', () => HttpResponse.json({ data: [] })),
      ],
    },
  },
  render: () => <ClientForm onClose={fn()} onSaved={fn()} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const radio = (name: string) => body().getByRole('radio', { name })

/** Company or person is the first choice of Basics, as two cards that say what each means. */
export const ClientType: Story = {
  play: async () => {
    const type = await body().findByRole('radiogroup', { name: 'Client type' })
    await expect(type).toBeVisible()
    await expect(radio('Company')).toBeChecked()
    await expect(body().getByRole('textbox', { name: 'Company name' })).toBeVisible()

    await userEvent.click(within(type).getByText('A private individual, by first and last name'))
    await expect(radio('Person')).toBeChecked()
    await expect(body().getByRole('textbox', { name: 'Full name' })).toBeVisible()
    await expect(body().queryByRole('textbox', { name: 'Company name' })).toBeNull()
  },
}

/** Native radios: Tab reaches the chosen card, the arrow keys move the choice, and the focus ring moves nothing. */
export const Keyboard: Story = {
  play: async () => {
    const type = await body().findByRole('radiogroup', { name: 'Client type' })
    const before = type.getBoundingClientRect()
    radio('Company').focus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(radio('Person')).toBeChecked())
    await expect(radio('Person')).toHaveFocus()
    await expect(body().getByRole('textbox', { name: 'Full name' })).toBeVisible()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(radio('Company')).toBeChecked())
    const after = type.getBoundingClientRect()
    await expect([after.top, after.height]).toEqual([before.top, before.height])
  },
}

/** Editing keeps the same choice: a client saved as a person opens with Person chosen and can change. */
export const EditPerson: Story = {
  render: () => (
    <ClientForm
      client={sampleClient({ name: 'Anna Muster', is_company: false })}
      onClose={fn()}
      onSaved={fn()}
    />
  ),
  play: async () => {
    await waitFor(() => expect(radio('Person')).toBeChecked())
    await expect(body().getByRole('textbox', { name: 'Full name' })).toHaveValue('Anna Muster')
    await userEvent.click(radio('Company'))
    await expect(body().getByRole('textbox', { name: 'Company name' })).toHaveValue('Anna Muster')
  },
}

export const Phone: Story = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '360px', height: '780px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async () => {
    const type = await body().findByRole('radiogroup', { name: 'Client type' })
    await userEvent.click(radio('Person'))
    await expect(radio('Person')).toBeChecked()
    await expect(type.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

export const Dark: Story = {
  parameters: { dark: true },
  play: ClientType.play,
}

const draftClient = sampleClient({
  street: null,
  street_number: null,
  zip: null,
  city: null,
  country: null,
  email: null,
  is_draft: true,
  missing_fields: ['street', 'street_number', 'zip', 'city', 'country'],
})
const control = (field: string) => document.getElementById(`client-${field}`)

/**
 * The fields invoicing needs carry a quiet mark, not the red asterisk (saving needs only the name), in the label's
 * row so a marked field lines up with an unmarked one; opened to complete the address, the first gap has the focus.
 */
export const RequiredToInvoice: Story = {
  render: () => <ClientForm client={draftClient} focus="address" onClose={fn()} onSaved={fn()} />,
  play: async () => {
    await waitFor(() => expect(document.activeElement).toBe(control('street')))
    await expect(body().getAllByText('Required to invoice')).toHaveLength(5)
    await expect(
      body().getByText('Required to send by email, unless “Invoices go to” is filled'),
    ).toBeInTheDocument()
    const street = control('street')?.closest('[data-slot="form-field"]')
    await expect(street?.querySelector('[data-needed-mark]')).not.toBeNull()
    await expect(street?.textContent).not.toContain('*')
    await expect(control('street')?.getBoundingClientRect().top).toBe(
      control('apt')?.getBoundingClientRect().top,
    )
  },
}

/** Opened from a send dialog, the form lands on the email. */
export const FocusEmail: Story = {
  render: () => (
    <ClientForm
      client={sampleClient({ email: null })}
      focus="email"
      onClose={fn()}
      onSaved={fn()}
    />
  ),
  play: async () => {
    await waitFor(() => expect(document.activeElement).toBe(control('email')))
  },
}

/** The server refuses to open the portal without an address: the form says so at the email field. */
export const PortalWithoutEmail: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/clients/tags', () => HttpResponse.json({ data: [] })),
        http.patch('/api/v1/clients/:id', () =>
          HttpResponse.json(
            {
              error: {
                code: 'no_portal_address',
                message: 'Add an email to let this client sign in.',
              },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  render: () => (
    <ClientForm
      client={sampleClient({ email: null, billing_email: null })}
      onClose={fn()}
      onSaved={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(await body().findByRole('switch', { name: /Let the client sign in/ }))
    await userEvent.click(body().getByRole('button', { name: 'Save changes' }))
    await expect(
      await body().findByText('Add an email to let this client sign in to the portal.'),
    ).toBeVisible()
    await waitFor(() => expect(document.activeElement).toBe(control('email')))
  },
}

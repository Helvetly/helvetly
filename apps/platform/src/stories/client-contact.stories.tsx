import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientDetail } from '@/components/clients/client-detail'
import type { Client, ClientInput } from '@/lib/clients'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Clients/Contact in place',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const saved = fn()
const checked = fn()
const command = fn()

const empty = () => sampleClient({ email: null, phone: null, website: null })

/** A 422 as the Go API sends it, with the field's own message. */
const invalid = (field: string, message: string) =>
  HttpResponse.json(
    {
      error: {
        code: 'validation_failed',
        message: 'Check the highlighted fields.',
        details: { fields: { [field]: message } },
      },
    },
    { status: 422 },
  )

/** The API's answers: the website check knows one site, the phone must be international, as the Go API does. */
const handlers = (client: Client, scopes?: string[]) => {
  let current = client
  return [
    sessionHandler(scopes ? { role: 'member', scopes } : {}),
    http.get('/api/v1/clients/cli_1', () => HttpResponse.json({ data: current })),
    http.post<never, { website: string }>('/api/v1/clients/website-check', async ({ request }) => {
      const { website } = await request.json()
      checked(website)
      await delay(300)
      if (website === 'www.Alpenglow.ch/')
        return HttpResponse.json({ data: { website: 'https://www.alpenglow.ch' } })
      return invalid('website', `We couldn't reach ${website}. Check the address and try again.`)
    }),
    http.patch<never, Partial<ClientInput>>('/api/v1/clients/cli_1', async ({ request }) => {
      const input = await request.json()
      if (input.phone && !input.phone.startsWith('+'))
        return invalid(
          'phone',
          'Enter the number in international format, such as +41 44 123 45 67.',
        )
      saved(input)
      current = { ...current, ...input }
      return HttpResponse.json({ data: current })
    }),
    http.get('/api/v1/clients/cli_1/change-request', () => HttpResponse.json({ data: null })),
    http.get('/api/v1/clients/cli_1/self-billing-agreements', () =>
      HttpResponse.json({ data: [] }),
    ),
  ]
}

const detail = () => (
  <>
    <ClientDetail id="cli_1" canDelete onClose={fn()} onCommand={command} />
    <Toaster />
  </>
)
const contactCard = async () => {
  const heading = await within(document.body).findByRole('heading', { name: 'Contact' })
  return within(heading.closest('section') ?? document.body)
}

/** "Add website" opens a field in place; the API checks the site and the address it answers on is saved. */
export const AddWebsite: Story = {
  parameters: { msw: { handlers: handlers(empty()) } },
  render: detail,
  play: async () => {
    saved.mockClear()
    checked.mockClear()
    const card = await contactCard()
    await userEvent.click(await card.findByRole('button', { name: 'Add website' }))
    const field = card.getByRole('textbox', { name: 'Add website' })
    await waitFor(() => expect(field).toHaveFocus())
    await userEvent.type(field, 'www.Alpenglow.ch/{Enter}')
    await expect(await card.findByText('Checking the site…')).toBeVisible()
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ website: 'https://www.alpenglow.ch' }))
    await expect(checked).toHaveBeenCalledWith('www.Alpenglow.ch/')
    await expect(await card.findByRole('link', { name: /www\.alpenglow\.ch/ })).toHaveAttribute(
      'href',
      'https://www.alpenglow.ch',
    )
    await expect(command).not.toHaveBeenCalled()
  },
}

/** A site that does not answer keeps the field open with the text and says why; nothing is saved. */
export const UnreachableWebsite: Story = {
  parameters: { msw: { handlers: handlers(empty()) } },
  render: detail,
  play: async () => {
    saved.mockClear()
    const card = await contactCard()
    await userEvent.click(await card.findByRole('button', { name: 'Add website' }))
    const field = card.getByRole('textbox', { name: 'Add website' })
    await userEvent.type(field, 'gone.example{Enter}')
    await expect(await card.findByRole('alert')).toHaveTextContent(
      "We couldn't reach gone.example. Check the address and try again.",
    )
    await expect(field).toHaveValue('gone.example')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(saved).not.toHaveBeenCalled()
    // Escape gives the link back without saving.
    await userEvent.keyboard('{Escape}')
    await expect(await card.findByRole('button', { name: 'Add website' })).toBeVisible()
    await expect(saved).not.toHaveBeenCalled()
  },
}

/** Email and phone are added in place too; a rejected phone shows the API's own message for it. */
export const AddEmailAndPhone: Story = {
  parameters: { msw: { handlers: handlers(empty()) } },
  render: detail,
  play: async () => {
    saved.mockClear()
    const card = await contactCard()
    await userEvent.click(await card.findByRole('button', { name: 'Add email' }))
    await userEvent.type(card.getByRole('textbox', { name: 'Add email' }), 'hi@alpenglow.ch{Enter}')
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith({ email: 'hi@alpenglow.ch' }))
    await expect(await card.findByRole('link', { name: 'hi@alpenglow.ch' })).toBeVisible()

    await userEvent.click(card.getByRole('button', { name: 'Add phone' }))
    const phone = card.getByRole('textbox', { name: 'Add phone' })
    await userEvent.type(phone, '044 123 45 67{Enter}')
    await expect(await card.findByRole('alert')).toHaveTextContent(
      'Enter the number in international format, such as +41 44 123 45 67.',
    )
    await userEvent.clear(phone)
    await userEvent.type(phone, '+41441234567{Enter}')
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith({ phone: '+41441234567' }))
    await expect(await card.findByRole('link', { name: '+41 44 123 45 67' })).toBeVisible()
    await expect(command).not.toHaveBeenCalled()
  },
}

/** Without the right to change clients the links open the form (which then says so), never an editor. */
export const ReadOnly: Story = {
  parameters: { msw: { handlers: handlers(empty(), ['read:*']) } },
  render: detail,
  play: async () => {
    command.mockClear()
    const card = await contactCard()
    // Until the session loads every control shows; the portal switch turns off once the read-only scopes are in.
    const portal = await within(document.body).findByRole('switch', { name: 'Client portal' })
    await waitFor(() => expect(portal).toBeDisabled())
    await userEvent.click(card.getByRole('button', { name: 'Add website' }))
    await expect(command).toHaveBeenCalledWith('edit', expect.anything())
    await expect(card.queryByRole('textbox')).not.toBeInTheDocument()
  },
}

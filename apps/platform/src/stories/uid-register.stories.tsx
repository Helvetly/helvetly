import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientDetail } from '@/components/clients/client-detail'
import { ClientForm } from '@/components/clients/client-form'
import type { ClientInput } from '@/lib/clients'
import type { RegisterCompany } from '@/lib/uid-register'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Clients/UID register',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const swisscom: RegisterCompany = {
  uid: 'CHE-102.753.938',
  name: 'Swisscom AG',
  street: 'Alte Tiefenaustrasse',
  house_number: '6',
  zip: '3050',
  city: 'Bern',
  canton: 'BE',
  active: true,
  vat: true,
}
const club: RegisterCompany = {
  uid: 'CHE-398.551.302',
  name: 'Swiss Chess Club',
  street: "Route de l'Arbarey",
  house_number: '636',
  zip: '1907',
  city: 'Saxon',
  active: true,
  vat: false,
}
const companies = [swisscom, club]

const saved = fn()
const searched = fn()

const base = [
  sessionHandler(),
  http.get('/api/v1/clients/tags', () => HttpResponse.json({ data: [] })),
  http.post<never, ClientInput>('/api/v1/clients', async ({ request }) => {
    const input = await request.json()
    saved(input)
    return HttpResponse.json({ data: sampleClient({ ...input, id: 'cli_new' }) }, { status: 201 })
  }),
]

/** A register that knows Swisscom and a chess club, by name or UID. */
const register = [
  http.get('/api/v1/uid-register/search', async ({ request }) => {
    const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? ''
    searched(q)
    await delay(120)
    return HttpResponse.json({
      data: companies.filter(
        (c) =>
          c.name.toLowerCase().includes(q) || c.uid.replace(/\D/g, '') === q.replace(/\D/g, ''),
      ),
    })
  }),
  http.get<{ uid: string }>('/api/v1/uid-register/companies/:uid', ({ params }) => {
    const company = companies.find((c) => c.uid === params.uid)
    return company
      ? HttpResponse.json({ data: company })
      : HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 })
  }),
]

const unavailable = [
  http.get('/api/v1/uid-register/*', () =>
    HttpResponse.json(
      {
        error: {
          code: 'uid_register_unavailable',
          message: "The Swiss UID register can't be reached right now.",
        },
      },
      { status: 503 },
    ),
  ),
]

const form = () => (
  <>
    <ClientForm onClose={fn()} onSaved={fn()} />
    <Toaster />
  </>
)
const body = () => within(document.body)
const nameInput = () => body().getByRole('textbox', { name: 'Company name' })

/** Typing part of a name lists the register's matches, with UID, place and VAT status; nothing else moves. */
export const Suggestions: Story = {
  parameters: { msw: { handlers: [...base, ...register] } },
  render: form,
  play: async () => {
    searched.mockClear()
    await waitFor(() => expect(nameInput()).toHaveFocus())
    const email = body().getByLabelText('Email')
    const top = email.getBoundingClientRect().top
    await userEvent.type(nameInput(), 'Swiss')
    const list = await body().findByRole('list', { name: 'Companies in the UID register' })
    const options = within(list).getAllByRole('button')
    await expect(options).toHaveLength(2)
    await expect(options[0]).toHaveTextContent('Swisscom AG')
    await expect(options[0]).toHaveTextContent('CHE-102.753.938 · 3050 Bern · VAT-registered')
    await expect(options[1]).not.toHaveTextContent('VAT-registered')
    // Debounced: one call for the whole word, not one per letter.
    await expect(searched).toHaveBeenCalledTimes(1)
    await expect(email.getBoundingClientRect().top).toBe(top)
    // Arrow keys move through the list; Escape closes it, back in the field, and keeps the drawer open.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await expect(options[1]).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(body().queryByRole('list', { name: 'Companies in the UID register' })).toBeNull(),
    )
    await expect(nameInput()).toHaveFocus()
    await expect(body().getByRole('dialog', { name: 'New client' })).toBeVisible()
  },
}

/** Picking fills name, address, UID and VAT number, says what it replaced, and undo puts it all back. */
export const PickAndUndo: Story = {
  parameters: { msw: { handlers: [...base, ...register] } },
  render: form,
  play: async () => {
    saved.mockClear()
    await waitFor(() => expect(nameInput()).toHaveFocus())
    await userEvent.type(body().getByLabelText('Street'), 'Bahnhofstrasse')
    await userEvent.type(nameInput(), 'swissc')
    await userEvent.click(await body().findByRole('button', { name: /Swisscom AG/ }))

    await expect(nameInput()).toHaveValue('Swisscom AG')
    await expect(body().getByLabelText('Street')).toHaveValue('Alte Tiefenaustrasse')
    await expect(body().getByLabelText('Number')).toHaveValue('6')
    await expect(body().getByLabelText('ZIP')).toHaveValue('3050')
    await expect(body().getByLabelText('City')).toHaveValue('Bern')
    await expect(body().getByLabelText('Business registration number')).toHaveValue(
      'CHE-102.753.938',
    )
    await expect(body().getByLabelText('VAT / UID number')).toHaveValue('CHE-102.753.938 MWST')
    await expect(
      body().getByText('Filled in from the UID register, replacing street.'),
    ).toBeVisible()
    // The VAT field checks its number against the register.
    await expect(
      await body().findByText('Swisscom AG: active and VAT-registered in the UID register.'),
    ).toBeVisible()

    await userEvent.click(body().getByRole('button', { name: 'Undo' }))
    await expect(nameInput()).toHaveValue('swissc')
    await expect(body().getByLabelText('Street')).toHaveValue('Bahnhofstrasse')
    await expect(body().getByLabelText('City')).toHaveValue('')
    await expect(body().getByLabelText('VAT / UID number')).toHaveValue('')
    await expect(body().queryByText(/Filled in from the UID register/)).toBeNull()

    // Picked again with the keyboard, then saved.
    await userEvent.clear(nameInput())
    await userEvent.type(nameInput(), 'Swisscom')
    await body().findByRole('button', { name: /Swisscom AG/ })
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await userEvent.click(body().getByRole('button', { name: 'Add client' }))
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Swisscom AG',
          registration_number: 'CHE-102.753.938',
          vat_number: 'CHE-102.753.938 MWST',
          city: 'Bern',
        }),
      ),
    )
  },
}

/** A company the register doesn't know is still added, with nothing in the way. */
export const NotFound: Story = {
  parameters: { msw: { handlers: [...base, ...register] } },
  render: form,
  play: async () => {
    saved.mockClear()
    await waitFor(() => expect(nameInput()).toHaveFocus())
    await userEvent.type(nameInput(), 'Bäckerei Nirgendwo')
    await expect(
      await body().findByText('No company found in the UID register. You can still add it.'),
    ).toBeVisible()
    await userEvent.type(body().getByLabelText('VAT / UID number'), 'CHE-109.322.551')
    await expect(
      await body().findByText('Not found in the UID register. You can still save it.'),
    ).toBeVisible()
    await userEvent.click(body().getByRole('button', { name: 'Add client' }))
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bäckerei Nirgendwo' })),
    )
  },
}

/** The register is down: the form says so, and works as without it. */
export const ServiceUnavailable: Story = {
  parameters: { msw: { handlers: [...base, ...unavailable] } },
  render: form,
  play: async () => {
    saved.mockClear()
    await waitFor(() => expect(nameInput()).toHaveFocus())
    await userEvent.type(nameInput(), 'Swisscom')
    const status = await body().findByText(
      "The UID register can't be reached right now. You can still fill in the details yourself.",
    )
    await expect(status).toBeVisible()
    await userEvent.type(body().getByLabelText('VAT / UID number'), 'CHE-102.753.938 MWST')
    await waitFor(() =>
      expect(body().getAllByText(/The UID register can't be reached right now/)).toHaveLength(1),
    )
    await userEvent.click(body().getByRole('button', { name: 'Add client' }))
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Swisscom', vat_number: 'CHE-102.753.938 MWST' }),
      ),
    )
  },
}

/** A typed UID of a company without VAT, with the MWST suffix: the field says to remove it. */
export const VatSuffixWithoutVat: Story = {
  parameters: { msw: { handlers: [...base, ...register] } },
  render: form,
  play: async () => {
    await userEvent.type(body().getByLabelText('VAT / UID number'), 'CHE-398.551.302 MWST')
    await expect(
      await body().findByText(
        "Swiss Chess Club isn't VAT-registered: remove MWST from the number.",
      ),
    ).toBeVisible()
  },
}

/** A person, or a company abroad, gets a plain name field: no register lookups. */
export const NoLookupForAPerson: Story = {
  parameters: { msw: { handlers: [...base, ...register] } },
  render: form,
  play: async () => {
    searched.mockClear()
    await userEvent.click(await body().findByRole('radio', { name: 'Person' }))
    await userEvent.type(body().getByRole('textbox', { name: 'Full name' }), 'Swiss Anna')
    await new Promise((resolve) => setTimeout(resolve, 600))
    await expect(searched).not.toHaveBeenCalled()
    await expect(body().queryByRole('list', { name: 'Companies in the UID register' })).toBeNull()
  },
}

const verified = sampleClient({
  name: 'Swisscom AG',
  verified_uid: 'CHE-102.753.938',
  uid_verified_at: '2026-11-19T09:00:00Z',
})

/** A client the register confirmed carries a quiet mark beside its name, with the UID and date on hover. */
export const VerifiedBadge: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/clients/cli_1', () => HttpResponse.json({ data: verified })),
        http.get('/api/v1/clients/cli_1/change-request', () => HttpResponse.json({ data: null })),
        http.get('/api/v1/clients/cli_1/self-billing-agreements', () =>
          HttpResponse.json({ data: [] }),
        ),
        http.get('/api/v1/auth/config', () =>
          HttpResponse.json({ google: false, email: true, passkey: true, dev_codes: false }),
        ),
      ],
    },
  },
  render: () => <ClientDetail id="cli_1" canDelete onClose={fn()} onCommand={fn()} />,
  play: async () => {
    const badge = await body().findByText('UID verified')
    await waitFor(() => expect(badge).toBeVisible())
    await userEvent.hover(badge)
    await expect(
      await body().findByRole('tooltip', {
        name: 'Verified in the Swiss UID register as CHE-102.753.938 on 19 Nov 2026.',
      }),
    ).toBeInTheDocument()
  },
}

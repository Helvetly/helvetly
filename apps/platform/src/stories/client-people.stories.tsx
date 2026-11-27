import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientDetail } from '@/components/clients/client-detail'
import { MakeParticipantDialog } from '@/components/clients/make-participant-dialog'
import type { Client, ClientInput, Contact, ContactInput, MergeResult } from '@/lib/clients'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Clients/People',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const person = (id: string, name: string, change: Partial<Contact> = {}): Contact => ({
  id,
  name,
  role: null,
  email: `${id.slice(4)}@eurochem.ch`,
  phone: null,
  is_primary: false,
  roles: ['contact'],
  portal_enabled: false,
  ...change,
})

/** EuroChem Group AG: Oliver handles the invoices; Lorenzo and Liam take the German lessons, Liam also signs. */
const euroChem = (change: Partial<Client> = {}) =>
  sampleClient({
    name: 'EuroChem Group AG',
    documents_to: 'company',
    portal_enabled: true,
    contacts: [
      person('con_oliver', 'Oliver Harvey', { is_primary: true, role: 'Head of HR' }),
      person('con_lorenzo', 'Lorenzo Percic', { roles: ['participant'], portal_enabled: true }),
      person('con_liam', 'Liam Gallagher', { roles: ['contact', 'participant'] }),
    ],
    ...change,
  })

const savedClient = fn()
const savedPerson = fn()

const handlers = (client: Client) => {
  let current = client
  return [
    sessionHandler(),
    http.get('/api/v1/clients/cli_1', () => HttpResponse.json({ data: current })),
    http.patch<never, Partial<ClientInput>>('/api/v1/clients/cli_1', async ({ request }) => {
      const input = await request.json()
      savedClient(input)
      current = { ...current, ...input }
      return HttpResponse.json({ data: current })
    }),
    http.post<never, Partial<ContactInput>>(
      '/api/v1/clients/cli_1/contacts',
      async ({ request }) => {
        const input = await request.json()
        savedPerson(input)
        const created = person('con_new', input.name ?? '', {
          ...input,
          email: input.email ?? null,
        })
        current = { ...current, contacts: [...current.contacts, created] }
        return HttpResponse.json({ data: created }, { status: 201 })
      },
    ),
    http.patch<{ id: string }, Partial<ContactInput>>(
      '/api/v1/clients/cli_1/contacts/:id',
      async ({ request, params }) => {
        const input = await request.json()
        savedPerson(input)
        current = {
          ...current,
          contacts: current.contacts.map((c) => (c.id === params.id ? { ...c, ...input } : c)),
        }
        return HttpResponse.json({ data: current.contacts.find((c) => c.id === params.id) })
      },
    ),
    http.get('/api/v1/clients/cli_1/change-request', () => HttpResponse.json({ data: null })),
    http.get('/api/v1/clients/cli_1/self-billing-agreements', () =>
      HttpResponse.json({ data: [] }),
    ),
  ]
}

const detail = () => (
  <>
    <ClientDetail id="cli_1" canDelete onClose={fn()} onCommand={fn()} />
    <Toaster />
  </>
)

const openPeople = async () => {
  const body = within(document.body)
  await userEvent.click(await body.findByRole('tab', { name: /People/ }))
  return body
}

/** Contacts and participants in two groups; Liam is in both, Lorenzo has portal access. */
export const CompanyPeople: Story = {
  parameters: { msw: { handlers: handlers(euroChem()) } },
  render: detail,
  play: async () => {
    const body = await openPeople()
    const contacts = within(await body.findByRole('region', { name: 'Contacts' }))
    const participants = within(body.getByRole('region', { name: 'Participants' }))
    await expect(contacts.getByText('Oliver Harvey')).toBeVisible()
    await expect(contacts.getByText('Liam Gallagher')).toBeVisible()
    await expect(contacts.queryByText('Lorenzo Percic')).toBeNull()
    await expect(participants.getByText('Lorenzo Percic')).toBeVisible()
    await expect(participants.getByText('Liam Gallagher')).toBeVisible()
    await expect(participants.getByText('Portal')).toBeVisible()
  },
}

/** "Add participant" opens the dialog; a participant's email is optional. */
export const AddParticipant: Story = {
  parameters: { msw: { handlers: handlers(euroChem()) } },
  render: detail,
  play: async () => {
    savedPerson.mockClear()
    const body = await openPeople()
    const participants = within(await body.findByRole('region', { name: 'Participants' }))
    await userEvent.click(participants.getByRole('button', { name: /Add participant/ }))
    const dialog = within(await body.findByRole('dialog', { name: 'Add participant' }))
    await userEvent.type(dialog.getByRole('textbox', { name: /Name/ }), 'Mia Keller')
    await userEvent.type(dialog.getByRole('textbox', { name: /City/ }), 'Basel')
    await userEvent.click(dialog.getByRole('button', { name: 'Add participant' }))
    await waitFor(() =>
      expect(savedPerson).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Mia Keller',
          roles: ['participant'],
          email: null,
          city: 'Basel',
        }),
      ),
    )
    await waitFor(() => expect(body.queryByRole('dialog', { name: 'Add participant' })).toBeNull())
    await expect(await participants.findByText('Mia Keller')).toBeVisible()
  },
}

/** The contact dialog: placeholders in every field, required name and email refused inline, then saved. */
export const AddContactDialog: Story = {
  parameters: { msw: { handlers: handlers(euroChem()) } },
  render: detail,
  play: async () => {
    savedPerson.mockClear()
    const body = await openPeople()
    const contacts = within(await body.findByRole('region', { name: 'Contacts' }))
    await userEvent.click(contacts.getByRole('button', { name: /Add contact/ }))
    const dialog = within(await body.findByRole('dialog', { name: 'Add contact' }))
    const name = dialog.getByRole('textbox', { name: /Name/ })
    await expect(name).toHaveFocus()
    await expect(name).toHaveAttribute('placeholder', 'Anna Muster')
    await expect(dialog.getByRole('textbox', { name: /Role/ })).toHaveAttribute(
      'placeholder',
      'Head of finance',
    )
    await expect(dialog.getByRole('textbox', { name: /Email/ })).toHaveAttribute(
      'placeholder',
      'anna@company.ch',
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Add contact' }))
    await expect(await dialog.findByText('Enter a name.')).toBeVisible()
    await expect(dialog.getByText('Enter an email address.')).toBeVisible()
    await expect(savedPerson).not.toHaveBeenCalled()
  },
}

/** Validation errors sit below their fields without moving the next row. */
export const AddContactValidation: Story = {
  parameters: { msw: { handlers: handlers(euroChem()) } },
  render: detail,
  play: async () => {
    savedPerson.mockClear()
    const body = await openPeople()
    const contacts = within(await body.findByRole('region', { name: 'Contacts' }))
    await userEvent.click(contacts.getByRole('button', { name: /Add contact/ }))
    const dialog = within(await body.findByRole('dialog', { name: 'Add contact' }))
    const phone = dialog.getByLabelText('Phone')
    const before = phone.getBoundingClientRect().top
    await userEvent.click(dialog.getByRole('button', { name: 'Add contact' }))
    await expect(await dialog.findByText('Enter a name.')).toBeVisible()
    await expect(phone.getBoundingClientRect().top).toBe(before)
    await userEvent.type(dialog.getByRole('textbox', { name: /Name/ }), 'Anna Muster')
    await userEvent.type(dialog.getByRole('textbox', { name: /Email/ }), 'anna@eurochem.ch')
    await userEvent.click(dialog.getByRole('button', { name: 'Add contact' }))
    await waitFor(() =>
      expect(savedPerson).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Anna Muster', email: 'anna@eurochem.ch' }),
      ),
    )
  },
}

/** Edit from the row menu opens the same dialog filled in; Save keeps the change. */
export const EditContact: Story = {
  parameters: { msw: { handlers: handlers(euroChem()) } },
  render: detail,
  play: async () => {
    savedPerson.mockClear()
    const body = await openPeople()
    await expect(await body.findByRole('link', { name: 'oliver@eurochem.ch' })).toHaveAttribute(
      'href',
      'mailto:oliver@eurochem.ch',
    )
    await userEvent.click(body.getByRole('button', { name: /Actions for Oliver Harvey/ }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Edit' }))
    const dialog = within(await body.findByRole('dialog', { name: 'Edit contact' }))
    const role = dialog.getByRole('textbox', { name: /Role/ })
    await expect(role).toHaveValue('Head of HR')
    await userEvent.clear(role)
    await userEvent.type(role, 'CFO')
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(savedPerson).toHaveBeenCalledWith(expect.objectContaining({ role: 'CFO' })),
    )
    await expect(await body.findByText('CFO')).toBeVisible()
  },
}

/** A company with nobody yet: two compact empty states that explain both groups. */
export const EmptyCompany: Story = {
  parameters: { msw: { handlers: handlers(euroChem({ contacts: [] })) } },
  render: detail,
  play: async () => {
    const body = await openPeople()
    await expect(await body.findByText('No contact persons yet')).toBeVisible()
    await expect(body.getByText('No participants yet')).toBeVisible()
    await expect(body.getByText(/Contact persons receive your invoices/)).toBeVisible()
  },
}

/** The row menu changes roles: Oliver becomes a participant too. */
export const ChangeRoles: Story = {
  parameters: { msw: { handlers: handlers(euroChem()) } },
  render: detail,
  play: async () => {
    savedPerson.mockClear()
    const body = await openPeople()
    await userEvent.click(await body.findByRole('button', { name: /Actions for Oliver Harvey/ }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Make a participant' }))
    await waitFor(() =>
      expect(savedPerson).toHaveBeenCalledWith({ roles: ['contact', 'participant'] }),
    )
  },
}

/** Company | Participants, with the help tooltip; switching saves documents_to. */
export const DocumentsGoToParticipants: Story = {
  parameters: { msw: { handlers: handlers(euroChem()) } },
  render: detail,
  play: async () => {
    savedClient.mockClear()
    const body = await openPeople()
    await expect(
      body.getByRole('button', { name: 'About where invoices and documents go' }),
    ).toBeVisible()
    const group = body.getAllByRole('group', { name: 'Invoices and documents go to' })[0]
    if (!group) throw new Error('no switch')
    await userEvent.click(within(group).getByText('Participants'))
    await waitFor(() => expect(savedClient).toHaveBeenCalledWith({ documents_to: 'participants' }))
  },
}

/** A person client is its own participant: no Participants group and no switch. */
export const PersonClient: Story = {
  parameters: {
    msw: {
      handlers: handlers(sampleClient({ name: 'Lorenzo Percic', is_company: false, contacts: [] })),
    },
  },
  render: detail,
  play: async () => {
    const body = await openPeople()
    await expect(await body.findByText(/No contact persons yet/)).toBeVisible()
    await expect(body.queryByRole('region', { name: 'Participants' })).toBeNull()
    await expect(body.queryByRole('group', { name: 'Invoices and documents go to' })).toBeNull()
  },
}

const preview: MergeResult = {
  dry_run: true,
  done: false,
  company_id: 'cli_euro',
  participant_id: 'con_lorenzo',
  match: 'name',
  counts: {
    invoices: 1,
    quotes: 0,
    instalment_plans: 0,
    engagements: 0,
    sessions: 2,
    documents: 1,
    folders: 3,
    shares: 0,
    invoices_addressed_to_person: 1,
    portal_enabled: false,
  },
  suggest_participants_mode: true,
}
const merged = fn()

/** "Make participant of…": pick EuroChem, see what moves, confirm, then the offer to send to participants. */
export const MakeParticipantOf: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/clients', () =>
          HttpResponse.json({
            data: [euroChem({ id: 'cli_euro' })],
            meta: { page: 1, page_size: 20, total: 1, total_pages: 1 },
          }),
        ),
        http.get('/api/v1/clients/cli_euro', () =>
          HttpResponse.json({ data: euroChem({ id: 'cli_euro' }) }),
        ),
        http.post<never, { dry_run: boolean }>(
          '/api/v1/clients/cli_lorenzo/make-participant',
          async ({ request }) => {
            const input = await request.json()
            if (!input.dry_run) merged(input)
            return HttpResponse.json({ data: { ...preview, dry_run: input.dry_run } })
          },
        ),
      ],
    },
  },
  render: () => (
    <>
      <MakeParticipantDialog
        client={sampleClient({ id: 'cli_lorenzo', name: 'Lorenzo Percic', is_company: false })}
        onClose={fn()}
        onDone={fn()}
      />
      <Toaster />
    </>
  ),
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: /^Company/ }))
    await userEvent.click(await body.findByText('EuroChem Group AG'))
    await expect(await body.findByText('Becomes the participant Lorenzo Percic.')).toBeVisible()
    await expect(body.getByText('1 invoice')).toBeVisible()
    await expect(body.getByText('2 sessions')).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Make participant' }))
    await waitFor(() =>
      expect(merged).toHaveBeenCalledWith(expect.objectContaining({ company_id: 'cli_euro' })),
    )
    await expect(await body.findByText('Send invoices to participants?')).toBeVisible()
  },
}

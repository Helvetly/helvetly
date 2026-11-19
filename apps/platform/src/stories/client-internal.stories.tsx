import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientDetail } from '@/components/clients/client-detail'
import type { Client, ClientInput } from '@/lib/clients'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Clients/Internal details',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const saved = fn()

/** The client from the report: one tag "sss" and a note "ssss" that could not be changed after adding. */
const reported = () => sampleClient({ internal_id: 'K-1', tags: ['sss'], note: 'ssss' })

const handlers = (client: Client, scopes?: string[]) => {
  let current = client
  return [
    sessionHandler(scopes ? { role: 'member', scopes } : {}),
    http.get('/api/v1/clients/tags', () =>
      HttpResponse.json({
        data: [
          { name: 'retainer', count: 4 },
          { name: 'vip', count: 2 },
        ],
      }),
    ),
    http.get('/api/v1/clients/cli_1', () => HttpResponse.json({ data: current })),
    http.patch<never, Partial<ClientInput>>('/api/v1/clients/cli_1', async ({ request }) => {
      const input = await request.json()
      saved(input)
      // The API stores an empty text as null, as `text()` in clients/input.go does.
      const next = { ...current, ...input }
      if (next.internal_id === '') next.internal_id = null
      if (next.note === '') next.note = null
      current = next
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
    <ClientDetail id="cli_1" canDelete onClose={fn()} onCommand={fn()} />
    <Toaster />
  </>
)
const internalCard = async () => {
  const body = within(document.body)
  const heading = await body.findByRole('heading', { name: 'Internal' })
  return within(heading.closest('section') ?? document.body)
}
/** An inline editor stays open, with the value inside it, until the save answers; then the row shows the value. */
const closed = (card: ReturnType<typeof within>, name: string) =>
  waitFor(() => expect(card.queryByRole('textbox', { name })).not.toBeInTheDocument())

/** Tags, the internal ID and the note change in place after they were added, through the client update. */
export const EditInPlace: Story = {
  parameters: { msw: { handlers: handlers(reported()) } },
  render: detail,
  play: async () => {
    saved.mockClear()
    const card = await internalCard()

    await userEvent.click(card.getByRole('button', { name: /Edit tags/ }))
    const tags = card.getByRole('textbox', { name: 'Tags' })
    await waitFor(() => expect(tags).toHaveFocus())
    await userEvent.click(card.getByRole('button', { name: 'Remove sss' }))
    await userEvent.type(tags, 'ret')
    await userEvent.click(await card.findByRole('button', { name: /retainer/ }))
    await userEvent.type(tags, 'Key account{Enter}{Enter}')
    await waitFor(() =>
      expect(saved).toHaveBeenLastCalledWith({ tags: ['retainer', 'Key-account'] }),
    )
    await closed(card, 'Tags')
    await expect(await card.findByText('Key-account')).toBeVisible()
    await expect(card.queryByText('sss')).not.toBeInTheDocument()

    await userEvent.click(card.getByRole('button', { name: /Edit internal ID/ }))
    const id = card.getByRole('textbox', { name: 'Internal ID' })
    await expect(id).toHaveValue('K-1')
    await userEvent.type(id, '042{Enter}')
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith({ internal_id: 'K-1042' }))
    await closed(card, 'Internal ID')
    await expect(await card.findByText('K-1042')).toBeVisible()

    await userEvent.click(card.getByRole('button', { name: /Edit note/ }))
    const note = card.getByRole('textbox', { name: 'Note' })
    await userEvent.clear(note)
    await userEvent.type(note, 'Pays late.{Enter}Call before sending.')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() =>
      expect(saved).toHaveBeenLastCalledWith({ note: 'Pays late.\nCall before sending.' }),
    )
    await closed(card, 'Note')
    await expect(await card.findByText(/Call before sending/)).toBeVisible()

    // Cleared values save as empty and offer to add them again.
    await userEvent.click(card.getByRole('button', { name: /Edit internal ID/ }))
    await userEvent.clear(card.getByRole('textbox', { name: 'Internal ID' }))
    await userEvent.keyboard('{Enter}')
    await expect(await card.findByRole('button', { name: 'Add internal ID' })).toBeVisible()
  },
}

/** Escape closes only the editor, not the client sheet around it, and keeps the value. */
export const EscapeKeepsValue: Story = {
  parameters: { msw: { handlers: handlers(reported()) } },
  render: detail,
  play: async () => {
    saved.mockClear()
    const card = await internalCard()
    await userEvent.click(card.getByRole('button', { name: /Edit tags/ }))
    await userEvent.type(card.getByRole('textbox', { name: 'Tags' }), '{Backspace}{Escape}')
    await expect(card.getByText('sss')).toBeVisible()
    await expect(card.getByRole('heading', { name: 'Internal' })).toBeVisible()
    await expect(saved).not.toHaveBeenCalled()
  },
}

/** A member who may only view clients sees the values without edit affordances. */
export const ReadOnly: Story = {
  parameters: { msw: { handlers: handlers(reported(), ['read:*']) } },
  render: detail,
  play: async () => {
    const card = await internalCard()
    // The sheet fades in; wait for it rather than the first frame.
    await waitFor(() => expect(card.getByText('sss')).toBeVisible())
    await expect(card.getByText('ssss')).toBeVisible()
    // Until the session loads every control shows; the read-only scopes then take them away.
    await waitFor(() =>
      expect(card.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument(),
    )
  },
}

/** Adding a note: the label stays on the first line, the field takes 1000 characters and grows only so far. */
export const AddNote: Story = {
  parameters: { msw: { handlers: handlers(sampleClient({ note: null })) } },
  render: detail,
  play: async () => {
    const card = await internalCard()
    await userEvent.click(await card.findByRole('button', { name: 'Add note' }))
    const note = card.getByRole('textbox', { name: 'Note' })
    const label = card.getByText('Note', { selector: 'span' })
    const top = label.getBoundingClientRect().top
    await expect(note).toHaveAttribute('maxlength', '1000')
    await userEvent.type(note, 'line{Enter}'.repeat(30))
    // The label did not move down with the taller field, and the field stopped growing.
    await expect(Math.abs(label.getBoundingClientRect().top - top)).toBeLessThan(1)
    await expect(note.getBoundingClientRect().height).toBeLessThanOrEqual(240)
    await expect(card.getByText('150 / 1000')).toBeVisible()
  },
}

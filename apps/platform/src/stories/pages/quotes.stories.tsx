import { expectButtonsDoNotSubmit } from '@helvetly/vitest-config/form-buttons'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse, type RequestHandler } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ClientsPage } from '@/components/clients/clients-page'
import { QuotesPage } from '@/components/quotes/quotes-page'
import { emailTemplateHandlers } from '@/mocks/email-templates'
import { quoteHandlers, quotePreviewHandler, resetQuotesMock } from '@/mocks/quotes'

import { sessionHandler, unavailable } from '../screen-fixtures'
import {
  closeHeidi,
  dark,
  desktop,
  expectFooterAtTheBottom,
  Frame,
  pageParameters,
  phone,
  shows,
} from './frame'
import { dropOpensImport, emptyOffersImport, noDropTarget } from './page-drop'

/** The quotes page with the stateful quote fake behind it; `handlers` answer first. */
const quotes = (query: Record<string, string> = {}, handlers: RequestHandler[] = []) =>
  pageParameters('/quotes', query, [...handlers, ...quoteHandlers, ...emailTemplateHandlers])

const meta = {
  title: 'Pages/Quotes',
  beforeEach: () => {
    closeHeidi()
    resetQuotesMock()
  },
  parameters: quotes(),
  render: () => (
    <Frame>
      <QuotesPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const page = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)
const wait = { timeout: 8000 }
/** Drawers, dialogs and empty states fade in: wait until one is shown. */
const seen = (element: HTMLElement) => waitFor(() => expect(element).toBeVisible())
/** A toast; one from an earlier story may still be on screen with the same words. */
const toasted = (canvasElement: HTMLElement, text: string | RegExp) =>
  waitFor(() =>
    expect(
      page(canvasElement)
        .getAllByText(text)
        .some((node) => node.checkVisibility()),
    ).toBe(true),
  )

export const List: Story = { play: shows('Keller Holzbau AG', 'Expired') }
export const ListDark = dark(List)
export const ListPhone = phone(List)

export const Loading: Story = {
  parameters: quotes({}, [http.get('/api/v1/quotes', () => delay('infinite'))]),
  play: async ({ canvasElement }) => {
    const loaders = await page(canvasElement).findAllByRole('status', { name: 'Loading' }, wait)
    await expect(loaders.length).toBeGreaterThan(0)
  },
}

const noQuotes = [
  http.get('/api/v1/quotes', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/imports', () => HttpResponse.json({ data: [] })),
]

/** A new workspace: next to its first quote the empty list offers Import, and a drop anywhere works too. */
export const Empty: Story = {
  parameters: quotes({}, noQuotes),
  play: async (context) => {
    await shows('No quotes yet')?.(context)
    // The header's button and the empty state's own.
    await expect(
      page(context.canvasElement).getAllByRole('button', { name: 'New quote' }),
    ).toHaveLength(2)
    await emptyOffersImport('No quotes yet')?.(context)
  },
}
export const EmptyDark = dark(Empty)
export const EmptyPhone = phone(Empty)

/** Import quotes sits in the split button beside New quote, as on the client's invoices. */
export const ImportFromMenu: Story = {
  parameters: quotes({}, noQuotes),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await body.findAllByText('No quotes yet', {}, wait)
    await userEvent.click(body.getByRole('button', { name: 'New quote options' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Import quotes' }))
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('import')).toBe('1'))
  },
}

/** Files dropped anywhere on the page open the quotes import with them chosen. */
export const DropStartsImport: Story = {
  parameters: quotes({}, noQuotes),
  play: dropOpensImport(
    'No quotes yet',
    'Drop to read these files into quotes',
    'quotes',
    new File(['%PDF-1.4'], 'offerte.pdf', { type: 'application/pdf' }),
  ),
}

/** Whoever may only read quotes has no drop target. */
export const ReadOnlyNoDrop: Story = {
  parameters: quotes({}, [sessionHandler({ role: 'member', scopes: ['read:*'] })]),
  play: noDropTarget('Keller Holzbau AG', 'quotes'),
}

export const LoadError: Story = {
  parameters: quotes({}, [http.get('/api/v1/quotes', unavailable)]),
  play: async (context) => {
    await shows('Couldn’t load quotes')?.(context)
    await seen(page(context.canvasElement).getByRole('button', { name: 'Try again' }))
  },
}

/** The Expired view: a sent quote past its date reads as expired, muted like a declined one. */
export const ExpiredView: Story = {
  parameters: quotes({ status: 'expired' }),
  play: async (context) => {
    await shows('Q-2026-001 (Rev. 2)', 'Expired')?.(context)
    const body = page(context.canvasElement)
    await expect(body.queryAllByText('Keller Holzbau AG')).toHaveLength(0)
    const badge = body.getAllByText('Expired').find((node) => node.closest('td'))
    await expect(badge).toHaveAttribute('data-tone', 'neutral')
  },
}

/** Typing goes to the URL (?q=) after a pause; the list follows the URL. */
export const Search: Story = {
  play: async (context) => {
    await shows('Keller Holzbau AG')?.(context)
    const body = page(context.canvasElement)
    await userEvent.type(body.getByRole('searchbox', { name: 'Search quotes' }), 'holzbau')
    await waitFor(() => expect(window.location.search).toContain('q=holzbau'), wait)
  },
}

/** The search covers number, client and reference. */
export const Searched: Story = {
  parameters: quotes({ q: 'holzbau' }),
  play: async (context) => {
    // Both Keller Holzbau quotes; a phone lists each by client, so count those.
    await shows('Keller Holzbau AG')?.(context)
    const body = page(context.canvasElement)
    await expect(
      body.getAllByText('Keller Holzbau AG').filter((node) => node.checkVisibility()),
    ).toHaveLength(2)
    await expect(body.queryAllByText('Sophie Meier')).toHaveLength(0)
  },
}
export const SearchedPhone = phone(Searched)

/** No quote matches: the empty state clears the search and the status view in one go. */
export const NoMatches: Story = {
  parameters: quotes({ status: 'sent', q: 'nobody' }),
  play: async (context) => {
    await shows('Nothing matches “nobody”')?.(context)
    const body = page(context.canvasElement)
    await userEvent.click(body.getByRole('button', { name: 'Clear search and filters' }))
    await expect(body.getByRole('searchbox', { name: 'Search quotes' })).toHaveValue('')
    await expect(window.location.search).not.toMatch(/q=|status=/)
  },
}
export const NoMatchesDark = dark(NoMatches)
export const NoMatchesPhone = phone(NoMatches)

/** A reload keeps the search and the view: both come back from the URL. */
export const UrlRestore: Story = {
  parameters: quotes({ status: 'expired', q: 'rev. 2' }),
  play: async (context) => {
    await shows('Q-2026-001 (Rev. 2)')?.(context)
    const body = page(context.canvasElement)
    await expect(body.getByRole('searchbox', { name: 'Search quotes' })).toHaveValue('rev. 2')
    const views = body.getByRole('navigation', { name: 'Views' })
    await expect(within(views).getByRole('button', { current: 'page' })).toHaveTextContent(
      'Expired',
    )
    await expect(body.queryAllByText('Keller Holzbau AG')).toHaveLength(0)
  },
}

export const Detail: Story = {
  parameters: quotes({ id: 'quo_sent' }),
  play: shows('27 Nov 2026'),
}
export const DetailDark = dark(Detail)
export const DetailPhone = phone(Detail)

/** A new quote needs a client; once chosen, the draft is saved with its lines. */
export const CreateDraft: Story = {
  parameters: quotes({ new: '1' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    const editor = await body.findByRole('form', { name: 'New quote' }, wait)
    await userEvent.click(within(editor).getByRole('button', { name: 'Save draft' }))
    await seen(await within(editor).findByText('Choose who this quote is for.'))

    await userEvent.click(within(editor).getByRole('button', { name: 'Choose a client' }))
    await userEvent.click(await body.findByRole('option', { name: /Sophie Meier/ }))
    await userEvent.type(
      within(editor).getByRole('textbox', { name: 'Line 1 description' }),
      'Website relaunch',
    )
    await userEvent.type(within(editor).getByRole('textbox', { name: 'Line 1 price' }), '4800')
    await userEvent.click(within(editor).getByRole('button', { name: 'Save draft' }))
    await toasted(canvasElement, 'Draft quote created.')
  },
}
export const CreateDraftPhone = phone(CreateDraft)

/** A draft is edited in the same drawer and its new reference shows once saved. */
export const EditDraft: Story = {
  parameters: quotes({ id: 'quo_draft' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('button', { name: 'Edit' }, wait))
    const editor = await body.findByRole('form', { name: 'Edit draft quote' })
    await userEvent.type(within(editor).getByRole('textbox', { name: /Reference/ }), 'PO 4711')
    await userEvent.click(within(editor).getByRole('button', { name: 'Save changes' }))
    await toasted(canvasElement, 'Quote saved.')
    await seen(await body.findByText('PO 4711'))
  },
}
export const EditDraftDark = dark(EditDraft)

/** The quote editor with the invoice's schedule controls, the preview answering a schedule's rows. */
const scheduled = quotes({ id: 'quo_draft' }, [quotePreviewHandler])
const openSchedule = async (canvasElement: HTMLElement) => {
  const body = page(canvasElement)
  await userEvent.click(await body.findByRole('button', { name: 'Edit' }, wait))
  const editor = await body.findByRole('form', { name: 'Edit draft quote' })
  await userEvent.click(within(editor).getByRole('switch', { name: 'Pay in instalments' }))
  const dialog = await body.findByRole('dialog', { name: 'Pay in instalments' })
  await seen(dialog)
  return { body, editor, dialog }
}

/** A payment schedule is added, a row typed off the total and put back, then saved with the quote; no reminders. */
export const ScheduleAdd: Story = {
  parameters: scheduled,
  play: async ({ canvasElement }) => {
    const { body, editor, dialog } = await openSchedule(canvasElement)
    await expect(
      within(dialog).getByText(/The client accepts these due dates with the quote/),
    ).toBeVisible()
    await expect(within(dialog).queryByRole('switch', { name: /Payment reminders/ })).toBeNull()
    const first = await within(dialog).findByRole('textbox', { name: 'Instalment 1 amount' }, wait)
    await userEvent.clear(first)
    await userEvent.type(first, '100.00')
    await seen(await within(dialog).findByText(/Off by/))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Equal parts' }))
    await waitFor(() => expect(within(dialog).queryByText(/Off by/)).toBeNull())
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(body.queryByRole('dialog', { name: 'Pay in instalments' })).toBeNull(),
    )
    await expect(within(editor).getByText(/3× · Monthly/)).toBeVisible()
    await userEvent.click(within(editor).getByRole('button', { name: 'Save changes' }))
    await toasted(canvasElement, 'Quote saved.')
  },
}
export const ScheduleAddDark = dark(ScheduleAdd)
export const ScheduleAddPhone = phone(ScheduleAdd)

/** The count is checked as on an invoice: outside 2 to 12 the dialog says so and cannot be saved. */
export const ScheduleValidation: Story = {
  parameters: scheduled,
  play: async ({ canvasElement }) => {
    const { dialog } = await openSchedule(canvasElement)
    const count = within(dialog).getByRole('textbox', { name: 'Number of instalments' })
    await userEvent.clear(count)
    await userEvent.type(count, '1')
    await seen(await within(dialog).findByText(/From 2 to 12/))
    await expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
  },
}

/** A saved schedule is edited (its rows open as saved) and removed again by switching it off. */
export const ScheduleEditRemove: Story = {
  parameters: scheduled,
  play: async ({ canvasElement }) => {
    const { body, editor, dialog } = await openSchedule(canvasElement)
    const count = within(dialog).getByRole('textbox', { name: 'Number of instalments' })
    await userEvent.clear(count)
    await userEvent.type(count, '4')
    await seen(await within(dialog).findByRole('textbox', { name: 'Instalment 4 amount' }, wait))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(editor).getByRole('button', { name: 'Save changes' }))
    await toasted(canvasElement, 'Quote saved.')

    await userEvent.click(await body.findByRole('button', { name: 'Edit' }, wait))
    const again = await body.findByRole('form', { name: 'Edit draft quote' })
    await seen(await within(again).findByText(/4× · Monthly/))
    await userEvent.click(within(again).getByRole('switch', { name: 'Pay in instalments' }))
    await expect(within(again).queryByText(/4× · Monthly/)).toBeNull()
    await userEvent.click(within(again).getByRole('button', { name: 'Save changes' }))
    await toasted(canvasElement, 'Quote saved.')
  },
}

/** Only Save saves: + Add line, the line menus, dates and discount controls leave the editor open and unsaved. */
export const EditorButtonsDoNotSubmit: Story = {
  parameters: quotes({ id: 'quo_draft' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('button', { name: 'Edit' }, wait))
    const editor = await body.findByRole('form', { name: 'Edit draft quote' })
    await expectButtonsDoNotSubmit(editor, { skip: /^(Close editor|Cancel)$/ })
    await expect(body.getByRole('form', { name: 'Edit draft quote' })).toBeVisible()
    await expect(body.queryByText('Quote saved.')).toBeNull()
  },
}

/** Send checks the address; without email set up it says so, and marking it sent still works. */
export const SendValidation: Story = {
  parameters: quotes({ id: 'quo_draft' }, [
    http.post('/api/v1/quotes/:id/send', async ({ request }) => {
      const body: unknown = await request.clone().json()
      if (typeof body === 'object' && body !== null && 'email' in body) return undefined
      return HttpResponse.json(
        { error: { code: 'mail_unavailable', message: 'Email is not set up on this server.' } },
        { status: 503 },
      )
    }),
  ]),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('button', { name: 'Send' }, wait))
    const dialog = await body.findByRole('dialog', { name: 'Send quote' })
    const to = within(dialog).getByRole('textbox', { name: /To/ })
    // The fields unlock once the drafted email has loaded; the address fills in on a later render.
    await waitFor(() => expect(to).toBeEnabled())
    await waitFor(() => expect(to).toHaveValue('hello@alpenglow.ch'))
    await userEvent.clear(to)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await seen(within(dialog).getByText('Add at least one email address.'))
    await userEvent.type(to, 'not-an-address')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await seen(within(dialog).getByText('“not-an-address” isn’t an email address.'))

    await userEvent.clear(to)
    await userEvent.type(to, 'anna@alpenglow.ch')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await seen(await within(dialog).findByText(/Email isn’t set up on this server/))

    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as sent' }))
    await toasted(canvasElement, /marked as sent/)
    const summary = await body.findByRole('region', { name: 'Summary' })
    await seen(await within(summary).findByText('3 Dec 2026'))
  },
}

/** Staff record the client's yes with a note; the drawer then offers the invoice. */
export const AcceptWithNote: Story = {
  parameters: quotes({ id: 'quo_sent' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('button', { name: 'Accept' }, wait))
    const dialog = await body.findByRole('dialog', { name: /Accept Quote Q-2026-004/ })
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Note/ }),
      'Confirmed by phone',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept quote' }))
    await toasted(canvasElement, 'Quote Q-2026-004 accepted.')
    await seen(await body.findByText('“Confirmed by phone”'))
    await seen(await body.findByRole('button', { name: 'Create invoice' }, wait))
  },
}

export const Decline: Story = {
  parameters: quotes({ id: 'quo_sent' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('button', { name: 'More actions' }, wait))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Decline' }))
    const dialog = await body.findByRole('dialog', { name: /Decline Quote Q-2026-004/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline quote' }))
    await toasted(canvasElement, 'Quote Q-2026-004 declined.')
    await seen(await body.findByRole('button', { name: 'Revise' }, wait))
  },
}

/** A declined quote becomes a draft again, revision 2, and opens in the editor. */
export const Revise: Story = {
  parameters: quotes({ id: 'quo_declined' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('button', { name: 'Revise' }, wait))
    const confirm = await body.findByRole('dialog', { name: /Revise Quote Q-2026-002/ })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Revise' }))
    await toasted(canvasElement, /is a draft again/)
    await seen(await body.findByRole('form', { name: 'Edit Q-2026-002 (Rev. 2)' }))
  },
}

export const CreateInvoice: Story = {
  parameters: quotes({ id: 'quo_accepted' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('button', { name: 'Create invoice' }, wait))
    const confirm = await body.findByRole('dialog', { name: /Create an invoice from/ })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Create invoice' }))
    await toasted(canvasElement, 'Draft invoice created from Quote Q-2026-003.')
  },
}

/** Converted elsewhere in the meantime: the 409 says so in words, not as a code. */
export const CreateInvoiceTwice: Story = {
  parameters: quotes({ id: 'quo_accepted' }, [
    http.post('/api/v1/quotes/:id/invoice', () =>
      HttpResponse.json(
        {
          error: {
            code: 'quote_invoiced',
            message: 'An invoice was already made from this quote.',
          },
        },
        { status: 409 },
      ),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('button', { name: 'Create invoice' }, wait))
    const confirm = await body.findByRole('dialog', { name: /Create an invoice from/ })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Create invoice' }))
    await toasted(canvasElement, /delete that draft to make a new one/)
  },
}

/** A member who may only view invoices sees quotes, but no way to change them. */
export const ReadOnlyMember: Story = {
  parameters: quotes({ id: 'quo_sent' }, [sessionHandler({ role: 'member', scopes: ['read:*'] })]),
  play: async (context) => {
    await shows('27 Nov 2026')?.(context)
    const body = page(context.canvasElement)
    await seen(body.getByRole('link', { name: 'Download PDF' }))
    await expect(body.queryByRole('button', { name: 'Accept' })).toBeNull()
    await expect(body.queryByRole('button', { name: 'Edit' })).toBeNull()
    await expect(body.queryByRole('button', { name: /New quote/ })).toBeNull()
  },
}

/** The client's Quotes tab lists its quotes; "New quote" opens the editor for that client in place. */
export const ClientTab: Story = {
  parameters: pageParameters('/clients', { id: 'cli_3' }, quoteHandlers),
  render: () => (
    <Frame>
      <ClientsPage />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('tab', { name: 'Quotes' }, wait))
    await seen(await body.findByText('Q-2026-003'))
    await userEvent.click(body.getByRole('button', { name: 'New quote' }))
    const editor = await body.findByRole('form', { name: 'New quote' })
    await seen(await within(editor).findByText('Sophie Meier'))
  },
}

/** The quote's footer text sits at the bottom of the paper, as on the invoice editor. */
export const EditorFooterAtTheBottom: Story = {
  parameters: quotes({ new: '1' }),
  play: async ({ canvasElement }) => {
    const editor = await page(canvasElement).findByRole('form', { name: 'New quote' }, wait)
    await expectFooterAtTheBottom(within(editor).getByRole('article'))
  },
}

import { expectButtonsDoNotSubmit } from '@helvetly/vitest-config/form-buttons'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse, type RequestHandler } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { ClientsPage } from '@/components/clients/clients-page'
import { QuotesPage } from '@/components/quotes/quotes-page'
import { aiConsent } from '@/mocks/ai-notice'
import { emailTemplateHandlers } from '@/mocks/email-templates'
import { listQuotes, quoteHandlers, quotePreviewHandler, resetQuotesMock } from '@/mocks/quotes'

import { emptyPage, sessionHandler, storySession, unavailable } from '../screen-fixtures'
import { filtersPlay } from './filters'
import {
  closeHeidi,
  dark,
  desktop,
  expectFooterAtTheBottom,
  expectPaperMeetsBottomPanel,
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

/** The list requests the stories made, newest last; the answer claims 120 quotes (the fake's rows on every page). */
const requested: URLSearchParams[] = []
const paged = http.get('/api/v1/quotes', ({ request }) => {
  const query = new URL(request.url).searchParams
  requested.push(query)
  const first = new URLSearchParams(query)
  first.set('page', '1')
  const answer = listQuotes(first)
  const { page_size } = answer.meta
  return HttpResponse.json({
    ...answer,
    meta: {
      page: Number(query.get('page')),
      page_size,
      total: 120,
      total_pages: Math.ceil(120 / page_size),
    },
  })
})
const lastRequest = () => requested.at(-1)?.toString() ?? ''

/** The server pages the list: page 2 of the URL is asked for, the pager moves on, and a search starts at page 1. */
export const PagesOnTheServer: Story = {
  parameters: quotes({ page: '2' }, [paged]),
  play: async (context) => {
    await shows('Keller Holzbau AG')?.(context)
    await expect(lastRequest()).toBe('page=2&page_size=50&sort=-issue_date')
    const body = page(context.canvasElement)
    const pager = await body.findByRole('navigation', { name: 'Pages' }, wait)
    await expect(within(pager).getByText('51–100 of 120')).toBeVisible()
    await userEvent.click(within(pager).getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(window.location.search).toContain('page=3'), wait)
    await userEvent.type(body.getByRole('searchbox', { name: 'Search quotes' }), 'holzbau')
    await waitFor(() => expect(window.location.search).toContain('q=holzbau'), wait)
    await expect(window.location.search).not.toContain('page=')
  },
}
export const PagesOnTheServerPhone = phone(PagesOnTheServer)

/** Every filter in the URL (view, client, dates, amounts, sort) goes to the API, not to the browser. */
export const FiltersGoToTheServer: Story = {
  parameters: quotes(
    {
      status: 'sent',
      client_name: 'Meier',
      from: '2026-11-01',
      to: '2026-11-30',
      min: '1000',
      max: '5000.50',
      sort: '-total',
    },
    [paged],
  ),
  play: async () => {
    await waitFor(
      () =>
        expect(lastRequest()).toBe(
          'page=1&page_size=50&status=sent&client_name=Meier&issued_from=2026-11-01&issued_to=2026-11-30&total_min=1000&total_max=5000.50&sort=-total',
        ),
      wait,
    )
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

/** Opens the History tab of the quote open in the drawer and answers its timeline. */
async function openHistory(canvasElement: HTMLElement) {
  const body = page(canvasElement)
  await userEvent.click(await body.findByRole('tab', { name: 'History' }, wait))
  return body.findByRole('list', { name: 'History' }, wait)
}

/** Each sent revision, newest first: when and to whom, the client's answer and reason, the current one marked. */
export const History: Story = {
  parameters: quotes({ id: 'quo_expired' }),
  play: async ({ canvasElement }) => {
    const timeline = within(await openHistory(canvasElement))
    const [current, earlier] = timeline.getAllByRole('listitem')
    await expect(current).toHaveTextContent(/Rev\. 2\s*Current/)
    await expect(current).toHaveTextContent('Sent 1 Aug 2026 to anna@alpenglow.ch')
    await expect(current).toHaveTextContent('Expired after 31 Aug 2026')
    await expect(earlier).toHaveTextContent('Rev. 1')
    await expect(earlier).toHaveTextContent('Declined 24 Jul 2026 by the client')
    await expect(earlier).toHaveTextContent('“super bad!!!”')
    // The current revision has nothing to compare with; the earlier one does.
    await expect(
      within(current!).queryByRole('button', { name: 'Compare with current' }),
    ).toBeNull()
    await seen(within(earlier!).getByRole('button', { name: 'Compare with current' }))
  },
}
export const HistoryDark = dark(History)
export const HistoryPhone = phone(History)

/** A revision's PDF opens in the drawer's PDF tab, which goes back to the current one. */
export const HistoryOpenPdf: Story = {
  parameters: quotes({ id: 'quo_expired' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    const [, earlier] = within(await openHistory(canvasElement)).getAllByRole('listitem')
    await userEvent.click(within(earlier!).getByRole('button', { name: 'Open PDF' }))
    await expect(body.getByRole('tab', { name: 'PDF' })).toHaveAttribute('aria-selected', 'true')
    await seen(body.getByRole('document', { name: 'Rev. 1 as sent' }))
    await expect(body.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/v1/quotes/quo_expired/revisions/1/pdf',
    )
    await userEvent.click(body.getByRole('button', { name: 'Back to current' }))
    await seen(body.getByRole('document', { name: /PDF of/ }))
  },
}

/** Compare with current: what changed in lines, totals and dates; the unchanged line folded away. */
export const HistoryCompare: Story = {
  parameters: quotes({ id: 'quo_expired' }),
  play: async ({ canvasElement }) => {
    const [, earlier] = within(await openHistory(canvasElement)).getAllByRole('listitem')
    await userEvent.click(within(earlier!).getByRole('button', { name: 'Compare with current' }))
    const diff = within(within(earlier!).getByRole('region', { name: 'Rev. 1 → current' }))
    const changes = diff.getAllByRole('listitem')
    await expect(changes[0]).toHaveTextContent(/Changed\s*Brand workshop/)
    await expect(changes[0]).toHaveTextContent(/Quantity\s*6\s*→\s*8/)
    await expect(changes[1]).toHaveTextContent(/Removed\s*Print run/)
    await expect(diff.getByText('Totals')).toBeVisible()
    await expect(diff.getByText('Valid until').closest('div')).toHaveTextContent(
      /31 Jul 2026\s*→\s*31 Aug 2026/,
    )
    await expect(diff.queryByText('Logo design')).toBeNull()
    await userEvent.click(diff.getByRole('button', { name: '1 unchanged line' }))
    await seen(diff.getByText('Logo design'))
    await userEvent.click(within(earlier!).getByRole('button', { name: 'Hide comparison' }))
    await expect(within(earlier!).queryByRole('region')).toBeNull()
  },
}
export const HistoryCompareDark = dark(HistoryCompare)
export const HistoryComparePhone = phone(HistoryCompare)

/** The Revision row of the details links to the History tab. */
export const RevisionLinksHistory: Story = {
  parameters: quotes({ id: 'quo_expired' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('button', { name: 'Rev. 2' }, wait))
    await expect(body.getByRole('tab', { name: 'History' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await seen(await body.findByRole('list', { name: 'History' }, wait))
  },
}

/** Revisions sent before the history was kept: the PDF where it is stored, nothing to compare. */
export const HistoryWithoutSnapshot: Story = {
  parameters: quotes({ id: 'quo_expired' }, [
    http.get('/api/v1/quotes/:id/revisions', () =>
      HttpResponse.json({
        data: [3, 2, 1].map((revision) => ({
          revision,
          sent_at: revision === 1 ? null : '2026-08-01T10:00:00Z',
          sent_to: [],
          outcome: null,
          outcome_at: null,
          outcome_by: null,
          reason: null,
          current: false,
          has_pdf: revision !== 1,
          snapshot: null,
        })),
      }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const timeline = within(await openHistory(canvasElement))
    const [, middle, first] = timeline.getAllByRole('listitem')
    await expect(middle).toHaveTextContent('Sent 1 Aug 2026')
    await expect(middle).toHaveTextContent('only its PDF can be opened')
    await expect(within(middle!).queryByRole('button', { name: 'Compare with current' })).toBeNull()
    await expect(first).toHaveTextContent('Sent before the history was kept')
    await expect(first).toHaveTextContent('Its PDF is no longer stored.')
    await expect(within(first!).queryByRole('button', { name: 'Open PDF' })).toBeNull()
  },
}

/** A quote that was never sent has no revisions yet. */
export const HistoryEmpty: Story = {
  parameters: quotes({ id: 'quo_draft' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await userEvent.click(await body.findByRole('tab', { name: 'History' }, wait))
    await seen(await body.findByText(/Each revision appears here once it is sent/, {}, wait))
  },
}

/** A declined quote: the badge and the decision notice both read in the destructive tone. */
export const DetailDeclined: Story = {
  parameters: quotes({ id: 'quo_declined' }),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    const notice = (
      await body.findByText('“Too expensive for this year.”', undefined, wait)
    ).closest('[data-slot="callout"]')
    await expect(notice).toHaveAttribute('data-tone', 'danger')
    const badge = body.getAllByText('Declined').find((el) => el.dataset.slot === 'badge')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-tone', 'red')
  },
}
export const DetailDeclinedDark = dark(DetailDeclined)

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
  parameters: scheduled,
  play: async ({ canvasElement }) => {
    const { body, editor, dialog } = await openSchedule(canvasElement)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    const instalments = within(editor).getByRole('switch', { name: 'Pay in instalments' })
    await expect(instalments).toHaveAttribute('type', 'button')
    await expect(instalments).not.toBeChecked()
    await expectButtonsDoNotSubmit(editor, { skip: /^(Close editor|Cancel|Pay in instalments)$/ })
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

/** No empty band between the quote's paper and the bottom panel. */
export const EditorPaperMeetsBottomPanel: Story = {
  parameters: quotes({ new: '1' }),
  play: async ({ canvasElement }) => {
    const editor = await page(canvasElement).findByRole('form', { name: 'New quote' }, wait)
    await expectPaperMeetsBottomPanel(within(editor).getByRole('article'))
  },
}

const row = (canvasElement: HTMLElement, name: string) =>
  page(canvasElement).getByRole('checkbox', { name: `Select ${name}` })
/** Which of `names` the scope does not show as a visible `role`; [] when it shows them all. */
const missing = (scope: ReturnType<typeof within>, role: 'button' | 'menuitem', names: string[]) =>
  names.filter((name) => !scope.queryByRole(role, { name })?.checkVisibility())
const bulkBar = (canvasElement: HTMLElement) =>
  within(page(canvasElement).getByRole('toolbar', { name: 'Selected rows' }))

/** Rows are picked with their checkboxes; the bar offers only what the picked quotes allow, then marks them. */
export const SelectAndBulkMark: Story = {
  play: async (context) => {
    const { canvasElement } = context
    await shows('Keller Holzbau AG')?.(context)
    await userEvent.click(row(canvasElement, 'Draft · Alpenglow Studio GmbH'))
    await userEvent.click(row(canvasElement, 'Q-2026-004 · Keller Holzbau AG'))
    const bar = bulkBar(canvasElement)
    await expect(
      page(canvasElement).getByRole('toolbar', { name: 'Selected rows' }),
    ).toHaveTextContent('2')
    await expect(
      missing(bar, 'button', [
        'Download PDFs',
        'Mark 1 as sent',
        'Mark 1 accepted',
        'Mark 1 declined',
        'Duplicate',
        'Delete draft',
      ]),
    ).toEqual([])
    await expect(bar.queryByRole('button', { name: /Delete 2/ })).toBeNull()

    await userEvent.click(bar.getByRole('button', { name: 'Mark 1 accepted' }))
    const confirm = await page(canvasElement).findByRole('dialog', {
      name: 'Mark 1 quote accepted?',
    })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Mark accepted' }))
    await toasted(canvasElement, '1 quote updated.')
    await waitFor(() =>
      expect(page(canvasElement).queryByRole('toolbar', { name: 'Selected rows' })).toBeNull(),
    )
  },
}
export const SelectAndBulkMarkDark = dark(SelectAndBulkMark)

/** The header's checkbox picks every quote in the view; a failure is said with how many and why. */
export const SelectAllPartialFailure: Story = {
  parameters: quotes({}, [
    http.post('/api/v1/quotes/quo_sent/duplicate', () =>
      HttpResponse.json(
        { error: { code: 'limit_reached', message: 'Your plan’s quotes are used up.' } },
        { status: 402 },
      ),
    ),
  ]),
  play: async (context) => {
    const { canvasElement } = context
    await shows('Keller Holzbau AG')?.(context)
    await userEvent.click(page(canvasElement).getByRole('checkbox', { name: 'Select all quotes' }))
    await expect(
      page(canvasElement).getByRole('toolbar', { name: 'Selected rows' }),
    ).toHaveTextContent('5')
    await userEvent.click(bulkBar(canvasElement).getByRole('button', { name: 'Duplicate' }))
    await toasted(
      canvasElement,
      /1 of 5 quotes couldn’t be changed: Your plan’s quotes are used up/,
    )
  },
}

/** Headers sort: the sorted one says so (and which way), a click on another goes to the URL. */
export const SortByHeader: Story = {
  parameters: quotes({ sort: 'client' }),
  play: async (context) => {
    const { canvasElement } = context
    await shows('Keller Holzbau AG')?.(context)
    const body = page(canvasElement)
    const client = body.getByRole('columnheader', { name: /Client/ })
    await expect(client).toHaveAttribute('aria-sort', 'ascending')
    const names = within(body.getAllByRole('rowgroup')[1] ?? canvasElement)
      .getAllByRole('row')
      .map((tr) => tr.textContent ?? '')
    await expect(names[0]).toContain('Alpenglow Studio GmbH')
    await expect(names.at(-1)).toContain('Sophie Meier')

    await userEvent.click(
      within(body.getByRole('columnheader', { name: /Total/ })).getByRole('button', {
        name: 'Total',
      }),
    )
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get('sort')).toBe('-total'),
    )
    await userEvent.click(within(client).getByRole('button', { name: 'Client' }))
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get('sort')).toBe('-client'),
    )
  },
}

/** A row's "…" offers what its state allows, the PDF, and no clipboard items; Duplicate opens the copy. */
export const RowMenu: Story = {
  play: async (context) => {
    const { canvasElement } = context
    await shows('Keller Holzbau AG')?.(context)
    const body = page(canvasElement)
    await userEvent.click(
      body.getByRole('button', { name: 'Actions for Q-2026-004 · Keller Holzbau AG' }),
    )
    const menu = await body.findByRole('menu')
    await expect(
      missing(within(menu), 'menuitem', [
        'Open details',
        'Send again',
        'Accept',
        'Decline',
        'Revise',
        'Duplicate',
        'Download PDF',
      ]),
    ).toEqual([])
    await expect(within(menu).queryByRole('menuitem', { name: /Copy|Edit|Delete/ })).toBeNull()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Duplicate' }))
    await toasted(canvasElement, 'Copy of Quote Q-2026-004 created as a draft.')
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get('id')).toMatch(/^quo_/),
    )
  },
}

/** Right-click on a draft's row: its own menu, with Edit and Delete; on a picked row among others, the bulk actions. */
export const RowContextMenus: Story = {
  play: async (context) => {
    const { canvasElement } = context
    await shows('Keller Holzbau AG')?.(context)
    const body = page(canvasElement)
    const draftRow = row(canvasElement, 'Draft · Alpenglow Studio GmbH').closest('tr')
    if (!draftRow) throw new Error('no draft row')
    await userEvent.pointer({ keys: '[MouseRight]', target: draftRow })
    const menu = await body.findByRole('menu')
    await expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(within(menu).getByRole('menuitem', { name: 'Delete draft' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())

    await userEvent.click(row(canvasElement, 'Draft · Alpenglow Studio GmbH'))
    await userEvent.click(row(canvasElement, 'Q-2026-003 · Sophie Meier'))
    await userEvent.pointer({ keys: '[MouseRight]', target: draftRow })
    const bulk = await body.findByRole('menu')
    await expect(within(bulk).getByText('2 selected')).toBeVisible()
    await expect(within(bulk).getByRole('menuitem', { name: 'Delete draft' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
  },
}

/** Whoever may only read quotes can pick rows for their PDFs, but gets no status change. */
export const ReadOnlyBulk: Story = {
  parameters: quotes({}, [sessionHandler({ role: 'member', scopes: ['read:*'] })]),
  play: async (context) => {
    const { canvasElement } = context
    await shows('Keller Holzbau AG')?.(context)
    await userEvent.click(row(canvasElement, 'Draft · Alpenglow Studio GmbH'))
    const bar = bulkBar(canvasElement)
    await expect(bar.getByRole('button', { name: 'Download PDFs' })).toBeVisible()
    await expect(bar.queryByRole('button', { name: /Mark|Duplicate|Delete/ })).toBeNull()
  },
}

/** The Filters popover and the search's chips show the URL's filters; a pick and "Clear all" go to the URL. */
export const Filters: Story = {
  parameters: quotes({ min: '100' }),
  play: filtersPlay({
    chips: ['Min. amount: 100'],
    pick: {
      control: /^Any date/,
      option: 'This year',
      key: 'from',
      value: `${new Date().getFullYear()}-01-01`,
    },
    cleared: ['min', 'from', 'to'],
  }),
}

/**
 * A sent quote's "…" in groups (view · send · status · edit · create), separated; Accept reads green, Decline red, and
 * "Create contract with AI" sits with Create invoice under Create.
 */
export const RowMenuGroups: Story = {
  play: async (context) => {
    const { canvasElement } = context
    await shows('Keller Holzbau AG')?.(context)
    const body = page(canvasElement)
    await userEvent.click(
      body.getByRole('button', { name: 'Actions for Q-2026-004 · Keller Holzbau AG' }),
    )
    const menu = await body.findByRole('menu')
    await expect(within(menu).getByText('Q-2026-004 · Keller Holzbau AG')).toBeVisible()
    const order = [...menu.querySelectorAll('[role=menuitem], [role=separator]')].map((node) =>
      node.getAttribute('role') === 'separator' ? '|' : (node.textContent ?? '').trim(),
    )
    await expect(order.join(', ')).toContain(
      'Open details, Download PDF, |, Send again, |, Accept, Decline, |, Revise, Duplicate, |, Create contract with AI',
    )
    const accept = within(menu).getByRole('menuitem', { name: 'Accept' })
    const decline = within(menu).getByRole('menuitem', { name: 'Decline' })
    const plain = within(menu).getByRole('menuitem', { name: 'Revise' })
    await expect(getComputedStyle(accept).color).not.toBe(getComputedStyle(plain).color)
    await expect(accept).toHaveAttribute('data-tone', 'success')
    await expect(decline).toHaveAttribute('data-variant', 'destructive')
    await expect(getComputedStyle(decline).color).not.toBe(getComputedStyle(accept).color)
    await userEvent.keyboard('{Escape}')
  },
}
export const RowMenuGroupsDark = dark(RowMenuGroups)

const contractTemplate = {
  id: 'tpl_service',
  name: 'Service contract',
  description: null,
  document: null,
  signers: [],
  fields: [
    {
      id: 'fld_client',
      kind: 'client.name',
      signer: null,
      label: null,
      page: 1,
      x: 0.1,
      y: 0.1,
      w: 0.4,
      h: 0.03,
    },
    {
      id: 'fld_total',
      kind: 'custom',
      signer: null,
      label: 'Total',
      page: 1,
      x: 0.1,
      y: 0.2,
      w: 0.4,
      h: 0.03,
    },
    {
      id: 'fld_start',
      kind: 'custom',
      signer: null,
      label: 'Start of work',
      page: 1,
      x: 0.1,
      y: 0.3,
      w: 0.4,
      h: 0.03,
    },
  ],
  used_count: 3,
  last_used_at: '2026-11-20T10:00:00Z',
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}
const otherTemplate = {
  ...contractTemplate,
  id: 'tpl_nda',
  name: 'NDA',
  fields: [],
  used_count: 0,
  last_used_at: null,
}
const exampleDoc = {
  id: 'doc_example',
  name: 'Vertrag Vorlage Deutsch V1.0.pdf',
  folder_id: null,
  folder: null,
  size: 48_000,
  content_type: 'application/pdf',
  kind: 'pdf',
  sha256: '0'.repeat(64),
  tags: [],
  ai_filing: null,
  previewable: false,
  links: [],
  retained_until: null,
  uploaded_by: storySession.user,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
}
const written = {
  title: 'Werkvertrag',
  language: 'de',
  intro: 'Gestützt auf das Angebot Q-2026-004.',
  clauses: [
    { heading: 'Gegenstand', body: 'Holzbauarbeiten gemäss Angebot.' },
    { heading: 'Vergütung', body: 'Gemäss Zahlungsplan.' },
  ],
  warnings: [],
}
/** The modes the AI was asked in, e.g. "ai" or "example:doc_example". */
let writes: string[] = []
const contractHandlers: RequestHandler[] = [
  http.get('/api/v1/templates', () =>
    HttpResponse.json({ data: [otherTemplate, contractTemplate] }),
  ),
  http.post('/api/v1/quotes/quo_sent/contract-draft', () =>
    HttpResponse.json({
      data: {
        fields: { fld_total: 'CHF 12’400.00', fld_start: '01.12.2026' },
        sources: { fld_total: 'quote', fld_start: 'ai' },
        ai: 'used',
        quote: { id: 'quo_sent', number: 'Q-2026-004' },
      },
    }),
  ),
  http.post('/api/v1/templates/tpl_service/documents', async ({ request }) => {
    const sent = (await request.json()) as { quote_id?: string; values: Record<string, string> }
    if (sent.quote_id !== 'quo_sent' || sent.values.fld_start !== '01.12.2026')
      return HttpResponse.json({ error: { code: 'bad', message: 'Wrong body.' } }, { status: 400 })
    return HttpResponse.json(
      {
        data: {
          contract_number: '2026/C/001',
          document: { id: 'doc_contract', name: '2026-C-001.pdf' },
          signature_request_id: null,
          emailed_to: null,
        },
      },
      { status: 201 },
    )
  }),
  http.get('/api/v1/heidi/usage', () =>
    HttpResponse.json({
      period: '2026-11',
      tokens_used: 0,
      tokens_included: 500_000,
      tokens_purchased: 0,
      tokens_remaining: 500_000,
      provider_available: true,
      consent: aiConsent(true),
    }),
  ),
  http.get('/api/v1/documents', () =>
    HttpResponse.json({
      ...emptyPage,
      data: [exampleDoc],
      meta: { ...emptyPage.meta, total: 1, total_pages: 1 },
    }),
  ),
  http.post('/api/v1/quotes/quo_sent/contract-drafts', async ({ request }) => {
    const sent = (await request.json()) as { mode: string; example_document_id?: string }
    writes.push(sent.mode + (sent.example_document_id ? `:${sent.example_document_id}` : ''))
    return HttpResponse.json({ data: written })
  }),
  http.post('/api/v1/quotes/quo_sent/contract-preview', () =>
    HttpResponse.json({
      data: {
        pdf: btoa('%PDF-1.7\n%%EOF\n'),
        pages: 1,
        warnings: [{ clause: 1, kind: 'amount', text: 'CHF 9’999.00' }],
      },
    }),
  ),
  http.post('/api/v1/quotes/quo_sent/contracts', async ({ request }) => {
    const sent = (await request.json()) as { title: string; clauses: { heading: string }[] }
    if (sent.title !== 'Werkvertrag Holzbau' || sent.clauses.length !== 2)
      return HttpResponse.json({ error: { code: 'bad', message: 'Wrong body.' } }, { status: 400 })
    return HttpResponse.json(
      {
        data: {
          contract_number: '2026/C/002',
          document: { id: 'doc_contract2', name: '2026-C-002.pdf' },
          signature_request_id: null,
          emailed_to: null,
        },
      },
      { status: 201 },
    )
  }),
  http.get('/api/v1/quotes/contract-counts', () => HttpResponse.json({ data: { quo_sent: 1 } })),
  http.get('/api/v1/quotes/quo_sent/contracts', () =>
    HttpResponse.json({
      data: [
        {
          document_id: 'doc_contract',
          number: '2026/C/001',
          name: '2026-C-001.pdf',
          created_at: '2026-11-23T10:00:00Z',
          signature: { id: 'sig_1', status: 'pending' },
        },
      ],
    }),
  ),
]

/**
 * "Create contract with AI" from a row: the most recently used template first, the quote fills its fields (the
 * AI's marked), then the numbered contract is saved and the toast names its number.
 */
export const ContractFromQuote: Story = {
  parameters: quotes({}, contractHandlers),
  play: async (context) => {
    const { canvasElement } = context
    await shows('Keller Holzbau AG')?.(context)
    const body = page(canvasElement)
    await expect(body.getAllByLabelText('A contract was made from this quote')[0]).toBeVisible()
    await userEvent.click(
      body.getByRole('button', { name: 'Actions for Q-2026-004 · Keller Holzbau AG' }),
    )
    await userEvent.click(await body.findByRole('menuitem', { name: 'Create contract with AI' }))
    const writer = await body.findByRole('dialog', { name: /Create contract with AI/ }, wait)
    await userEvent.click(within(writer).getByRole('button', { name: /Fill a template/ }))
    await userEvent.click(within(writer).getByRole('button', { name: 'Next' }))
    const drawer = await body.findByRole('dialog', { name: /Create contract with AI/ }, wait)
    const list = await within(drawer).findByLabelText('Templates', {}, wait)
    const rows = await within(list).findAllByRole('button')
    await expect(rows[0]).toHaveTextContent('Service contract')
    await expect(within(drawer).queryByRole('searchbox', { name: 'Search clients' })).toBeNull()
    await userEvent.click(rows[0] as HTMLElement)
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))

    const start = await within(drawer).findByRole('textbox', { name: /Start of work/ }, wait)
    await expect(start).toHaveValue('01.12.2026')
    await expect(within(drawer).getByRole('textbox', { name: /Total/ })).toHaveValue(
      'CHF 12’400.00',
    )
    await expect(within(drawer).getByLabelText('Filled by AI from quote Q-2026-004')).toBeVisible()
    await expect(within(drawer).getByLabelText('Filled from quote Q-2026-004')).toBeVisible()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Save to Documents' }))
    await toasted(canvasElement, 'Contract 2026/C/001 created')
    await waitFor(() =>
      expect(body.getByRole('button', { name: 'Send for signature' })).toBeVisible(),
    )
    await expect(body.getByRole('button', { name: 'Open' })).toBeInTheDocument()
  },
}

const openWriter = async (context: Parameters<NonNullable<Story['play']>>[0]) => {
  await shows('Keller Holzbau AG')?.(context)
  const body = page(context.canvasElement)
  await userEvent.click(
    body.getByRole('button', { name: 'Actions for Q-2026-004 · Keller Holzbau AG' }),
  )
  await userEvent.click(await body.findByRole('menuitem', { name: 'Create contract with AI' }))
  return body.findByRole('dialog', { name: /Create contract with AI/ }, wait)
}

/**
 * Three ways to start: written with AI (the default), after an example document, or a template. With AI it
 * writes every section, which are edited, removed and regenerated beside the preview, then saved as a numbered
 * contract.
 */
export const ContractWrittenWithAI: Story = {
  parameters: quotes({}, contractHandlers),
  beforeEach: () => {
    writes = []
  },
  play: async (context) => {
    const { canvasElement } = context
    const drawer = await openWriter(context)
    const ai = within(drawer).getByRole('button', { name: /Write it with AI/ })
    await expect(ai).toHaveAttribute('aria-pressed', 'true')
    await expect(ai).toHaveTextContent('Recommended')
    await expect(
      within(drawer).getByRole('button', { name: /Based on an example document/ }),
    ).toBeEnabled()
    await expect(within(drawer).getByRole('button', { name: /Fill a template/ })).toBeEnabled()
    await userEvent.type(
      within(drawer).getByRole('textbox', { name: 'Instructions for the AI' }),
      '6-month course',
    )
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))

    const title = await within(drawer).findByRole('textbox', { name: 'Title' }, wait)
    await expect(title).toHaveValue('Werkvertrag')
    await expect(writes).toEqual(['ai'])
    await userEvent.type(title, ' Holzbau')
    await expect(within(drawer).getByRole('textbox', { name: 'Heading of section 1' })).toHaveValue(
      'Gegenstand',
    )
    // the preview's check flags an amount the quote lacks
    await expect(
      await within(drawer).findByText(/CHF 9’999.00 is not an amount/, {}, wait),
    ).toBeVisible()

    // no AI per section: the prompt writes them all, edited by hand; a third added and removed again
    await expect(within(drawer).queryByRole('button', { name: /Improve/ })).toBeNull()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Add section' }))
    await expect(
      within(drawer).getByRole('textbox', { name: 'Heading of section 3' }),
    ).toBeVisible()
    await userEvent.click(
      within(drawer).getAllByRole('button', { name: 'Remove section' })[2] as HTMLElement,
    )
    await expect(within(drawer).queryByRole('textbox', { name: 'Heading of section 3' })).toBeNull()
    await expect(writes).toEqual(['ai'])

    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Save to Documents' }))
    await toasted(canvasElement, 'Contract 2026/C/002 created')
  },
}

/** Regenerate writes the whole text again, replacing the edits. */
export const ContractRegenerate: Story = {
  parameters: quotes({}, contractHandlers),
  beforeEach: () => {
    writes = []
  },
  play: async (context) => {
    const drawer = await openWriter(context)
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))
    const title = await within(drawer).findByRole('textbox', { name: 'Title' }, wait)
    await userEvent.clear(title)
    await userEvent.type(title, 'Changed')
    await userEvent.click(within(drawer).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(title).toHaveValue('Werkvertrag'))
    await expect(writes).toEqual(['ai', 'ai'])
  },
}

/** An example document from Documents shapes the AI's contract: no template builder, straight to review. */
export const ContractFromExample: Story = {
  parameters: quotes({}, contractHandlers),
  beforeEach: () => {
    writes = []
  },
  play: async (context) => {
    const { canvasElement } = context
    const drawer = await openWriter(context)
    await userEvent.click(
      within(drawer).getByRole('button', { name: /Based on an example document/ }),
    )
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))
    await expect(await within(drawer).findByText('Choose an example contract.')).toBeVisible()
    await userEvent.click(
      await within(drawer).findByText('Vertrag Vorlage Deutsch V1.0.pdf', {}, wait),
    )
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))
    await expect(await within(drawer).findByRole('textbox', { name: 'Title' }, wait)).toHaveValue(
      'Werkvertrag',
    )
    await expect(writes).toEqual(['example:doc_example'])
    const body = page(canvasElement)
    await expect(body.queryByText('What is the template built on?')).toBeNull()
    await expect(body.queryByRole('button', { name: /Place fields/ })).toBeNull()
  },
}

/** The quote's details list its contracts: number, signature status, Open. */
export const ContractSection: Story = {
  parameters: quotes({ id: 'quo_sent' }, contractHandlers),
  play: async ({ canvasElement }) => {
    const body = page(canvasElement)
    await expect(await body.findByText('2026/C/001', {}, wait)).toBeVisible()
    await expect(body.getByText('Out for signature')).toBeVisible()
    await expect(body.getByRole('button', { name: 'Open' })).toBeVisible()
    await expect(body.queryByRole('button', { name: 'Send for signature' })).toBeNull()
  },
}
export const ContractSectionDark = dark(ContractSection)

const noAI = http.get('/api/v1/auth/config', () =>
  HttpResponse.json({
    google: true,
    email: true,
    passkey: true,
    dev_codes: false,
    ai_available: false,
  }),
)

/** An installation without AI: the row offers "Create contract", which fills a template straight away. */
export const ContractWithoutAI: Story = {
  parameters: quotes({}, [noAI, ...contractHandlers]),
  play: async (context) => {
    await shows('Keller Holzbau AG')?.(context)
    const body = page(context.canvasElement)
    await userEvent.click(
      body.getByRole('button', { name: 'Actions for Q-2026-004 · Keller Holzbau AG' }),
    )
    await expect(await body.findByRole('menuitem', { name: 'Create contract' })).toBeVisible()
    await expect(body.queryByRole('menuitem', { name: 'Create contract with AI' })).toBeNull()
    await userEvent.click(body.getByRole('menuitem', { name: 'Create contract' }))
    const drawer = await body.findByRole('dialog', { name: /Create contract/ }, wait)
    await expect(await within(drawer).findByLabelText('Templates', {}, wait)).toBeVisible()
    await expect(within(drawer).queryByRole('button', { name: /Write it with AI/ })).toBeNull()
  },
}

/** The automation pool is used up: the AI ways say so with the way to more, and Next waits for a template. */
export const ContractAIBudgetUsedUp: Story = {
  parameters: quotes({}, [
    http.get('/api/v1/billing', () =>
      HttpResponse.json({
        data: billingFixture({
          plan: 'pro',
          status: 'active',
          locked: false,
          usage: [{ limit: 'ai_automation_tokens_per_month', used: 5_000_000, max: 5_000_000 }],
        }),
      }),
    ),
    ...contractHandlers,
  ]),
  play: async (context) => {
    const drawer = await openWriter(context)
    await expect(await within(drawer).findByText('No AI budget left', {}, wait)).toBeVisible()
    const more = within(drawer).getByRole('link', { name: 'Buy more' })
    await expect(more.getAttribute('href')).toMatch(
      /^\/settings\/billing\/plans\/?\?plan=business$/,
    )
    await expect(within(drawer).getByRole('button', { name: 'Next' })).toBeDisabled()
    await userEvent.click(within(drawer).getByRole('button', { name: /Fill a template/ }))
    await expect(within(drawer).getByRole('button', { name: 'Next' })).toBeEnabled()
  },
}

/** A failed write is a toast naming the action with the server's words; the drawer stays on its step. */
export const ContractWriteFails: Story = {
  parameters: quotes({}, [
    http.post('/api/v1/quotes/quo_sent/contract-drafts', () =>
      HttpResponse.json(
        { error: { code: 'ai_unavailable', message: 'AI is paused for a moment.' } },
        { status: 503 },
      ),
    ),
    ...contractHandlers,
  ]),
  play: async (context) => {
    const drawer = await openWriter(context)
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))
    await toasted(context.canvasElement, 'Couldn’t write the contract')
    await toasted(context.canvasElement, 'AI is paused for a moment.')
    await expect(within(drawer).getByRole('button', { name: /Write it with AI/ })).toBeVisible()
  },
}

/**
 * A template without signing fields can still be sent for signature: the client and you sign on a page added at
 * the end, or "Place fields myself" files it and opens the signatures' drawer.
 */
export const ContractTemplateSignatures: Story = {
  parameters: quotes({}, [
    http.post('/api/v1/templates/tpl_service/documents', async ({ request }) => {
      const sent = (await request.json()) as {
        delivery: { type: string; signers?: { name: string; email: string }[] }
      }
      if (sent.delivery.type !== 'signature' || sent.delivery.signers?.length !== 2)
        return HttpResponse.json(
          { error: { code: 'bad', message: 'Wrong body.' } },
          { status: 400 },
        )
      return HttpResponse.json(
        {
          data: {
            contract_number: '2026/C/003',
            document: { id: 'doc_contract3', name: '2026-C-003.pdf' },
            signature_request_id: 'sig_3',
            emailed_to: null,
          },
        },
        { status: 201 },
      )
    }),
    ...contractHandlers,
  ]),
  play: async (context) => {
    const writer = await openWriter(context)
    await userEvent.click(within(writer).getByRole('button', { name: /Fill a template/ }))
    await userEvent.click(within(writer).getByRole('button', { name: 'Next' }))
    const drawer = await page(context.canvasElement).findByRole(
      'dialog',
      { name: /Create contract with AI/ },
      wait,
    )
    const list = await within(drawer).findByLabelText('Templates', {}, wait)
    await userEvent.click((await within(list).findAllByRole('button'))[0] as HTMLElement)
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))
    await within(drawer).findByRole('textbox', { name: /Start of work/ }, wait)
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))

    const sign = await within(drawer).findByRole('button', { name: /Send for signature/ }, wait)
    await expect(sign).toBeEnabled()
    await expect(sign).toHaveTextContent('Everyone signs online on a page added at the end.')
    await userEvent.click(sign)
    await expect(within(drawer).getByText('Signer 1')).toBeVisible()
    await expect(within(drawer).getByText('Signer 2')).toBeVisible()
    await expect(within(drawer).getByRole('switch', { name: /Place fields myself/ })).toBeVisible()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Next' }))
    await userEvent.click(
      await within(drawer).findByRole('button', { name: 'Send for signature' }, wait),
    )
    await toasted(context.canvasElement, /2026\/C\/003/)
  },
}

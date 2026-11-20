import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

import { EngagementsPage } from '@/components/engagements/engagements-page'
import type { Entry, Period } from '@/lib/engagements'
import { sampleSettings } from '@/test/invoice-api'

import { sessionHandler } from '../screen-fixtures'
import { engagements, page } from './api'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'
import { dropOpensImport, emptyList, emptyOffersImport, noDropTarget, readOnly } from './page-drop'

const meta = {
  title: 'Pages/Engagements',
  beforeEach: closeHeidi,
  parameters: pageParameters('/engagements'),
  render: () => (
    <Frame>
      <EngagementsPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { play: shows('Bookkeeping support') }
export const ListDark = dark(List)
export const ListPhone = phone(List)

export const Detail: Story = {
  parameters: pageParameters('/engagements', { id: 'eng_1' }),
  play: shows('Brand guidelines'),
}
export const DetailDark = dark(Detail)
export const DetailPhone = phone(Detail)

/**
 * The new-engagement drawer's choices are full-width rows: every title on one line, the marks in one column, and
 * the extra-hours price shows the regular price's currency and basis. "Paid separately" comes first and is the default.
 */
export const NewForm: Story = {
  parameters: pageParameters('/engagements', { new: '1' }, [
    http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
  ]),
  play: async () => {
    // The drawer first shows a loader in a sheet of its own; the form replaces it once the settings are in.
    const radios = await within(document.body).findAllByRole('radio')
    const dialog = within(radios[0]!.closest<HTMLElement>('[role=dialog]')!)
    for (const name of ['Schedule', 'Billing']) {
      const rows = radios
        .filter((radio) => radio.closest('[role=radiogroup]')?.getAttribute('aria-label') === name)
        .map((radio) => radio.closest('label')!)
      expect(rows.length).toBeGreaterThan(1)
      const widths = new Set(rows.map((row) => Math.round(row.getBoundingClientRect().width)))
      expect(widths.size).toBe(1)
      for (const row of rows) {
        const title = row.querySelector<HTMLElement>('[id$=-title]')!
        const line = parseFloat(getComputedStyle(title).lineHeight)
        expect(title.getBoundingClientRect().height).toBeLessThan(line * 1.5)
      }
    }
    // A new engagement starts as "Paid separately", listed first, and the preview says nothing is invoiced.
    const billing = within(dialog.getByRole('radiogroup', { name: 'Billing' })).getAllByRole(
      'radio',
    )
    expect(billing.map((radio) => radio.getAttribute('value'))).toEqual([
      'paid',
      'advance',
      'arrears',
    ])
    expect(dialog.getByRole('radio', { name: 'Paid separately' })).toBeChecked()
    // the side panel is hidden on phones, so only its presence counts
    expect(dialog.getByText(/Nothing is invoiced from this engagement/)).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('radio', { name: 'Advance' }))
    await userEvent.click(dialog.getByRole('button', { name: /Different price for extra/ }))
    const overage = await dialog.findByRole('textbox', { name: /Price for extra/ })
    await expect(overage.parentElement).toHaveTextContent(/^CHF\s*Net$/)
  },
}
export const NewFormDark = dark(NewForm)
export const NewFormPhone = phone(NewForm)

const settingsHandler = http.get('/api/v1/invoice-settings', () =>
  HttpResponse.json({ data: sampleSettings() }),
)

/** The open new-engagement drawer, switched to a recurring schedule from 19.11.2026. */
async function recurringForm() {
  const radios = await within(document.body).findAllByRole('radio')
  const dialog = within(radios[0]!.closest<HTMLElement>('[role=dialog]')!)
  await userEvent.click(dialog.getByRole('radio', { name: /Recurring/ }))
  fireEvent.change(dialog.getByLabelText(/^Starts/), { target: { value: '2026-11-19' } })
  return dialog
}

const box = (element: HTMLElement) => element.getBoundingClientRect()

/**
 * Recurring: Every | Starts | Ends share one row when the form is wide, each control one height, the "leave empty"
 * hint under Ends. The periods stop at the end date: the first three, "…", then the last with its number and count.
 */
export const NewFormRecurring: Story = {
  parameters: pageParameters('/engagements', { new: '1' }, [settingsHandler]),
  play: async () => {
    const dialog = await recurringForm()
    const every = dialog.getByRole('textbox', { name: /Every/ })
    const unit = dialog.getByRole('button', { name: /Period/ })
    const starts = dialog.getByLabelText(/^Starts/)
    const ends = dialog.getByLabelText(/^Ends/)
    for (const control of [unit, starts, ends]) expect(box(control).height).toBe(box(every).height)
    expect(box(every).top).toBe(box(starts).top)
    expect(box(starts).top).toBe(box(ends).top)
    // The number and the unit fill their cell.
    const cell = every.closest<HTMLElement>('[data-slot=form-field]')!
    expect(Math.round(box(unit).right - box(every).left)).toBe(Math.round(box(cell).width))
    expect(dialog.getByText('Leave empty to run until you cancel it.')).toBeVisible()
    // Open-ended: three periods, "…", and new ones keep coming.
    const periods = dialog.getByRole('heading', { name: 'First periods' }).parentElement!
    expect(within(periods).getAllByRole('listitem')).toHaveLength(4)
    expect(dialog.getByText(/starts automatically/)).toBeInTheDocument()

    fireEvent.change(ends, { target: { value: '2027-03-19' } })
    const listed = dialog.getByRole('heading', { name: 'Periods' }).parentElement!
    expect(
      within(listed)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '1.19.11.2026 – 18.12.2026',
      '2.19.12.2026 – 18.1.2027',
      '3.19.1.2027 – 18.2.2027',
      '…',
      '5.19.3.2027 – 19.3.2027',
    ])
    expect(listed).toHaveTextContent('5 periods in total')

    // An end date inside the first period leaves that one period, shortened, and nothing after it.
    fireEvent.change(ends, { target: { value: '2026-11-20' } })
    expect(
      within(listed)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1.19.11.2026 – 20.11.2026'])
    expect(listed).toHaveTextContent('1 period in total')
    expect(dialog.queryByText(/starts automatically/)).not.toBeInTheDocument()
    expect(dialog.queryByText(/18\. Dec/)).not.toBeInTheDocument()
  },
}
export const NewFormRecurringDark = dark(NewFormRecurring)

/** On a phone, Every takes a row of its own, full width, above Starts and Ends. */
export const NewFormRecurringPhone: Story = {
  ...phone(NewFormRecurring),
  play: async () => {
    const dialog = await recurringForm()
    const every = dialog.getByRole('textbox', { name: /Every/ })
    const unit = dialog.getByRole('button', { name: /Period/ })
    const starts = dialog.getByLabelText(/^Starts/)
    expect(box(every).bottom).toBeLessThan(box(starts).top)
    expect(Math.round(box(unit).right - box(every).left)).toBe(Math.round(box(starts).width))
    expect(Math.round(box(unit).right)).toBe(Math.round(box(starts).right))
    expect(box(unit).height).toBe(box(starts).height)
  },
}

/** The contract is picked from Documents (or none); with no documents the control is disabled and says why. */
export const NewFormContractDocument: Story = {
  parameters: pageParameters('/engagements', { new: '1' }, [settingsHandler]),
  play: async () => {
    const radios = await within(document.body).findAllByRole('radio')
    const dialog = within(radios[0]!.closest<HTMLElement>('[role=dialog]')!)
    const picker = dialog.getByRole('button', { name: /^Contract document/ })
    await waitFor(() => expect(picker).toBeEnabled())
    await expect(picker).toHaveTextContent('None')
    await userEvent.click(picker)
    const body = within(document.body)
    await userEvent.type(body.getByPlaceholderText('Search…'), 'lease')
    await userEvent.click(await body.findByRole('option', { name: /Office lease 2026\.pdf/ }))
    await expect(picker).toHaveTextContent('Office lease 2026.pdf')
  },
}

export const NewFormNoDocuments: Story = {
  parameters: pageParameters('/engagements', { new: '1' }, [
    settingsHandler,
    http.get('/api/v1/documents', () => HttpResponse.json(page([]))),
  ]),
  play: async () => {
    const radios = await within(document.body).findAllByRole('radio')
    const dialog = within(radios[0]!.closest<HTMLElement>('[role=dialog]')!)
    const picker = dialog.getByRole('button', { name: /^Contract document/ })
    await waitFor(() => expect(picker).toBeDisabled())
    await expect(
      dialog.getByText(/No documents yet\. Upload the signed contract in Documents/),
    ).toBeVisible()
  },
}

const longDescription = 'Weekly lessons. '.repeat(94).trim() // 1503 characters, saved before the limit
const saved: { body?: Record<string, unknown> } = {}

/**
 * An engagement saved with a description over today's 1000 characters still opens and saves unchanged; the counter
 * is red and a hint explains it. Changing the description then asks for at most 1000.
 */
export const EditLongDescription: Story = {
  parameters: pageParameters('/engagements', { id: 'eng_1' }, [
    settingsHandler,
    http.get('/api/v1/engagements/eng_1', () =>
      HttpResponse.json({ data: { ...engagements[0], description: longDescription } }),
    ),
    http.patch('/api/v1/engagements/eng_1', async ({ request }) => {
      saved.body = (await request.json()) as Record<string, unknown>
      return HttpResponse.json({ data: { ...engagements[0], description: longDescription } })
    }),
  ]),
  play: async (context) => {
    await shows('Design retainer')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'More actions' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Edit' }))
    const description = await body.findByRole('textbox', { name: /Description/ })
    await expect(description).toHaveValue(longDescription)
    await expect(body.getByText(`${longDescription.length} / 1000`)).toBeVisible()
    await expect(body.getByText(/Saved before the 1000-character limit/)).toBeVisible()

    await userEvent.type(description, '!')
    await userEvent.click(body.getByRole('button', { name: 'Save changes' }))
    await expect(await body.findByText('Use at most 1000 characters.')).toBeVisible()
    expect(saved.body).toBeUndefined()

    await userEvent.type(description, '{Backspace}')
    await userEvent.click(body.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(saved.body?.description).toBe(longDescription))
  },
}

const middle = (rect: DOMRect) => rect.top + rect.height / 2

/** The header's tabs: one height, centred in the bar like its buttons, and no "+" to save a view. */
export const HeaderTabs: Story = {
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    const views = body.getByRole('navigation', { name: 'Views' })
    const tabs = within(views).getAllByRole('button')
    const active = within(views).getByRole('button', { current: 'page' })
    const button = body.getByRole('button', { name: /New engagement/ }).getBoundingClientRect()
    for (const tab of tabs) {
      const rect = tab.getBoundingClientRect()
      expect(rect.height).toBe(active.getBoundingClientRect().height)
      expect(Math.abs(middle(rect) - middle(button))).toBeLessThanOrEqual(1)
    }
    expect(body.queryByRole('button', { name: 'Save a view' })).not.toBeInTheDocument()
  },
}
export const HeaderTabsDark = dark(HeaderTabs)

const anna = { id: 'usr_story', name: 'Anna Muster' }
const period = (change: Partial<Period>): Period => ({
  id: 'epr_1',
  index: 2,
  starts_on: '2026-11-01',
  ends_on: '2026-11-30',
  natural_ends_on: '2026-11-30',
  quantity: '10',
  full_quantity: '10',
  unearned: '0',
  carried_in: '0',
  available: '10',
  unit_price: '120.00',
  overage_unit_price: '120.00',
  used: '6.5',
  remaining: '3.5',
  overage: '0',
  expected: '3.652',
  state: 'open',
  advance_invoice: null,
  invoiced_quantity: '0',
  uninvoiced_quantity: '6.5',
  invoices: [],
  ...change,
})
const history: Period[] = [
  period({}),
  period({
    id: 'epr_0',
    index: 1,
    starts_on: '2026-10-01',
    ends_on: '2026-10-31',
    natural_ends_on: '2026-10-31',
    used: '11',
    remaining: '0',
    overage: '1',
    expected: '10',
    state: 'closed',
    invoiced_quantity: '11',
    uninvoiced_quantity: '0',
    invoices: [{ id: 'inv_1', number: '2026-014', status: 'paid', kind: 'usage' }],
  }),
]
const entry = (id: string, periodId: string, date: string, quantity: string, note: string | null) =>
  ({
    id,
    period_id: periodId,
    date,
    quantity,
    note,
    client_performance: null,
    client_performance_on_invoice: false,
    performed_by: anna,
    invoice:
      periodId === 'epr_0'
        ? { id: 'inv_1', number: '2026-014', status: 'paid', kind: 'usage' }
        : null,
    created_at: `${date}T16:00:00Z`,
    created_by: anna,
  }) satisfies Entry
const log: Entry[] = [
  entry('ent_5', 'epr_1', '2026-11-07', '1', 'Call with Lena about the launch'),
  entry('ent_4', 'epr_1', '2026-11-05', '3', 'Brand guidelines, typography and colour pages'),
  {
    ...entry('ent_6', 'epr_1', '2026-11-05', '0.5', 'Review call'),
    client_performance: 'You did well',
    client_performance_on_invoice: true,
    performed_by: { id: 'usr_9', name: 'Maximiliane Kowalczyk-Sonnenberg' },
  },
  entry('ent_3', 'epr_1', '2026-11-03', '2.5', null),
  entry('ent_2', 'epr_0', '2026-10-21', '6', 'Homepage layout'),
  entry('ent_1', 'epr_0', '2026-10-08', '5', 'Kick-off workshop'),
]
// Invoiced with a line per entry, so an entry's performance chosen for the invoice shows "on invoice".
const perEntry = engagements.map((one) =>
  one.id === 'eng_1' ? { ...one, invoice_detail: 'per_entry' as const } : one,
)
const drawer = (entries: Entry[]) =>
  pageParameters('/engagements', { id: 'eng_1' }, [
    http.get('/api/v1/engagements/:id', ({ params }) => {
      const found = perEntry.find((one) => one.id === params.id)
      // Anything else (the summary) falls through to the page's own handlers.
      return found && HttpResponse.json({ data: found })
    }),
    http.get('/api/v1/engagements', () => HttpResponse.json(page(perEntry))),
    http.get('/api/v1/engagements/:id/periods', () => HttpResponse.json({ data: history })),
    http.get('/api/v1/engagements/:id/entries', () => HttpResponse.json({ data: entries })),
  ])

/** The drawer's entries grouped by period with totals, and periods with one next action and a menu. */
export const DetailSections: Story = {
  parameters: drawer(log),
  play: async (context) => {
    await shows('Kick-off workshop')?.(context)
    const body = within(document.body)
    const current = body.getByRole('region', { name: '1.–30. Nov 2026' })
    await expect(current).toHaveTextContent('4 entries · 7 h')
    // Each day owns its entries: two on Thu 5 Nov.
    const days = within(current).getAllByRole('time')
    await expect(days.map((day) => day.textContent)).toEqual([
      'Sat 7 Nov',
      'Thu 5 Nov',
      'Tue 3 Nov',
    ])
    const thursday = within(days[1]?.parentElement ?? current).getAllByRole('listitem')
    await expect(thursday).toHaveLength(2)
    const review = thursday[1] ?? current
    await expect(review).toHaveTextContent('Review call')
    await expect(review).toHaveTextContent('Client performance: You did well')
    await expect(within(review).getByText('on invoice')).toBeVisible()
    // A long author name is cut short, and the tooltip says it whole.
    const author = within(review).getByText('Maximiliane Kowalczyk-Sonnenberg')
    await expect(author.scrollWidth).toBeGreaterThan(author.clientWidth)
    await userEvent.hover(author)
    await waitFor(() =>
      expect(body.getByRole('tooltip')).toHaveTextContent('Maximiliane Kowalczyk-Sonnenberg'),
    )
    await expect(current).toHaveTextContent('No note')
    await expect(body.getByRole('region', { name: '1.–31. Oct 2026' })).toHaveTextContent(
      '2 entries · 11 h',
    )
    await expect(body.getByRole('link', { name: 'Export CSV' })).toBeVisible()
    await expect(body.getByText('Expected by now').nextElementSibling).toHaveTextContent('3 h')
    await expect(body.getAllByRole('button', { name: 'Invoice usage' })).toHaveLength(1)
    const menus = body.getAllByRole('button', { name: 'Period actions' })
    await expect(menus).toHaveLength(2)
    await userEvent.click(menus[0] ?? document.body)
    await waitFor(() =>
      expect(body.getByRole('menuitem', { name: 'Download report' })).toBeVisible(),
    )
    await expect(body.getByRole('menuitem', { name: 'Send report…' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
  },
}
export const DetailSectionsDark = dark(DetailSections)
export const DetailSectionsPhone = phone(DetailSections)

/** Nothing logged yet: a calm line, no export. */
export const DetailNoEntries: Story = {
  parameters: drawer([]),
  play: async (context) => {
    await shows(/Nothing logged yet\./)?.(context)
    await expect(within(document.body).queryByRole('link', { name: 'Export CSV' })).toBeNull()
  },
}

const visible = (elements: HTMLElement[]) => {
  const found = elements.find((element) => element.checkVisibility())
  if (!found) throw new Error('Nothing visible')
  return found
}
const bar = () => within(document.body).findByRole('toolbar', { name: 'Selected rows' })

/** Ticking rows brings up the shared bulk bar; its icon buttons carry their names, and ✕ clears. */
export const Selection: Story = {
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(visible(body.getAllByRole('checkbox', { name: 'Select German lessons' })))
    await userEvent.click(
      visible(body.getAllByRole('checkbox', { name: 'Select Bookkeeping support' })),
    )
    const toolbar = await bar()
    await expect(toolbar).toHaveTextContent('Selected: 2')
    await expect(within(toolbar).getByRole('button', { name: 'Export CSV' })).toBeVisible()
    await expect(within(toolbar).getByRole('button', { name: 'Delete' })).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Clear selection' }))
    await waitFor(() => expect(body.queryByRole('toolbar', { name: 'Selected rows' })).toBeNull())
  },
}
export const SelectionDark = dark(Selection)
export const SelectionPhone = phone(Selection)

/** Select all, delete from the bar: one confirmation, then every selected engagement goes. */
export const BulkDelete: Story = {
  parameters: pageParameters('/engagements', {}, [
    http.delete('/api/v1/engagements/:id', () => new HttpResponse(null, { status: 204 })),
  ]),
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('checkbox', { name: 'Select all items on this page' }))
    const toolbar = await bar()
    await expect(toolbar).toHaveTextContent('Selected: 3')
    await userEvent.click(within(toolbar).getByRole('button', { name: 'Delete' }))
    const dialog = await body.findByRole('dialog', { name: 'Delete 3 engagements?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(
        body.getAllByText('3 engagements deleted.').some((node) => node.checkVisibility()),
      ).toBe(true),
    )
    await expect(body.queryByRole('toolbar', { name: 'Selected rows' })).toBeNull()
  },
}

/** A row's "…" menu: the drawer's actions, renew only for a one-off engagement. */
export const RowMenu: Story = {
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Actions for German lessons' }))
    const menu = await body.findByRole('menu')
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Open details', 'Log delivery', 'Edit', 'Renew', 'Cancel engagement', 'Delete'])
    await userEvent.keyboard('{Escape}')
    // The open menu hides the rest of the page from the accessibility tree until it has closed.
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
    await userEvent.click(body.getByRole('button', { name: 'Actions for Bookkeeping support' }))
    await expect(
      within(await body.findByRole('menu')).queryByRole('menuitem', { name: 'Renew' }),
    ).toBeNull()
    await userEvent.click(body.getByRole('menuitem', { name: 'Edit' }))
    await expect(
      await body.findByRole('dialog', { name: /Edit Bookkeeping support/ }),
    ).toBeVisible()
  },
}
export const RowMenuDark = dark(RowMenu)

let logged: unknown
/** "Log delivery" from a row's menu: the detail's quick form in a dialog, which closes once the entry is saved. */
export const RowMenuLogDelivery: Story = {
  parameters: pageParameters('/engagements', {}, [
    http.post('/api/v1/engagements/:id/entries', async ({ request }) => {
      logged = await request.json()
      return HttpResponse.json({
        data: { entry: { id: 'ent_new', quantity: '1.5' }, period: null },
      })
    }),
  ]),
  play: async (context) => {
    logged = undefined
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Actions for German lessons' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Log delivery' }))
    const dialog = await body.findByRole('dialog', { name: 'Log delivery' })
    await expect(within(dialog).getByText(/German lessons/)).toBeVisible()
    await expect(within(dialog).getByRole('button', { name: 'Log' })).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Quantity' }), '1,5')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Lesson 4')
    // German lessons invoice a line per entry: the performance can go on it, once there is one, and only if chosen.
    const onInvoice = within(dialog).getByRole('checkbox', {
      name: 'Also print on the invoice line',
    })
    await expect(onInvoice).toBeDisabled()
    const performance = within(dialog).getByRole('textbox', { name: 'Client performance' })
    await userEvent.type(performance, 'Well prepared')
    await expect(onInvoice).toBeEnabled()
    await expect(onInvoice).not.toBeChecked()
    await userEvent.hover(
      within(dialog).getByRole('button', { name: 'About Also print on the invoice line' }),
    )
    await waitFor(() =>
      expect(body.getByRole('tooltip')).toHaveTextContent('20.11.2026 · Lesson · You did well'),
    )
    await userEvent.click(onInvoice)
    await userEvent.type(performance, '{Enter}')
    await waitFor(() => expect(body.queryByRole('dialog', { name: 'Log delivery' })).toBeNull())
    await expect(logged).toMatchObject({
      quantity: '1.5',
      note: 'Lesson 4',
      client_performance: 'Well prepared',
      client_performance_on_invoice: true,
    })
    // The undo toast names what was logged (it is still fading in).
    await expect(await body.findByText(/Logged 1\.5/)).toBeInTheDocument()
  },
}
export const RowMenuLogDeliveryDark = dark(RowMenuLogDelivery)

/** An engagement invoiced as one summary line has no entry line to print the performance on: the choice is off and says why. */
export const LogDeliverySummaryInvoice: Story = {
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Actions for Bookkeeping support' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Log delivery' }))
    const dialog = await body.findByRole('dialog', { name: 'Log delivery' })
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Client performance' }),
      'Well prepared',
    )
    await expect(
      within(dialog).getByRole('checkbox', { name: 'Also print on the invoice line' }),
    ).toBeDisabled()
    await userEvent.hover(
      within(dialog).getByRole('button', { name: 'About Also print on the invoice line' }),
    )
    await waitFor(() =>
      expect(body.getByRole('tooltip')).toHaveTextContent(
        'This engagement invoices one summary line',
      ),
    )
  },
}

// Design retainer as one recorded on 19 Nov 2026: its first period runs from then to the end of the year.
const late = {
  ...engagements[0]!,
  start_date: '2026-11-19',
  current_period: {
    ...engagements[0]!.current_period!,
    starts_on: '2026-11-19',
    ends_on: '2026-12-31',
  },
}
const lateHandlers = [
  http.get('/api/v1/engagements/:id', () => HttpResponse.json({ data: late })),
  http.get('/api/v1/engagements', () => HttpResponse.json(page([late, ...engagements.slice(1)]))),
]
const beforeStart = /Pick a date from .*2026 \(the engagement's start\)\./

/** The date field of the quick form under `scope`, set to `day` (a date input takes no typing in a test). */
const setDate = (scope: HTMLElement, day: string) =>
  fireEvent.change(within(scope).getByLabelText('Date'), { target: { value: day } })

/**
 * A day before the engagement's start, from a row's menu: the form says so under the date and sends nothing; the
 * start day itself is logged. The date input also offers only the days the API accepts.
 */
export const RowMenuLogBeforeStart: Story = {
  parameters: pageParameters('/engagements', {}, [
    http.post('/api/v1/engagements/:id/entries', async ({ request }) => {
      logged = await request.json()
      return HttpResponse.json({ data: { entry: { id: 'ent_new', quantity: '1' }, period: null } })
    }),
    ...lateHandlers,
  ]),
  play: async (context) => {
    logged = undefined
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Actions for Design retainer' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Log delivery' }))
    const dialog = await body.findByRole('dialog', { name: 'Log delivery' })
    const date = within(dialog).getByLabelText('Date')
    await expect(date).toHaveAttribute('min', '2026-11-19')
    setDate(dialog, '2026-11-13')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Quantity' }), '1{Enter}')
    await expect(await within(dialog).findByText(beforeStart)).toBeVisible()
    await expect(date).toHaveAttribute('aria-invalid', 'true')
    await expect(date).toHaveFocus()
    await expect(logged).toBeUndefined()
    // Picking a day it accepts clears the message; the start day is logged.
    setDate(dialog, '2026-11-19')
    await expect(within(dialog).queryByText(beforeStart)).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: /^Log 1/ }))
    await waitFor(() => expect(body.queryByRole('dialog', { name: 'Log delivery' })).toBeNull())
    await expect(logged).toMatchObject({ date: '2026-11-19', quantity: '1' })
  },
}

/** The same check in the engagement's detail: the one form both places use. */
export const DetailLogBeforeStart: Story = {
  parameters: pageParameters('/engagements', { id: 'eng_1' }, [
    http.post('/api/v1/engagements/:id/entries', () => {
      logged = 'sent'
      return HttpResponse.json({ data: { entry: { id: 'ent_new', quantity: '1' }, period: null } })
    }),
    ...lateHandlers,
  ]),
  play: async () => {
    logged = undefined
    const body = within(document.body)
    const panel = (await body.findByRole('heading', { name: 'Log delivery' })).closest('section')!
    await expect(within(panel).getByLabelText('Date')).toHaveAttribute('min', '2026-11-19')
    setDate(panel, '2026-11-13')
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Quantity' }), '1{Enter}')
    await expect(await within(panel).findByText(beforeStart)).toBeVisible()
    await expect(logged).toBeUndefined()
  },
}

/** A refusal from the API lands under the field it names, never as a bare "check the fields". */
export const DetailLogServerFieldError: Story = {
  parameters: pageParameters('/engagements', { id: 'eng_1' }, [
    http.post('/api/v1/engagements/:id/entries', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the highlighted fields.',
            details: { fields: { date: 'The date is outside every period.' } },
          },
        },
        { status: 422 },
      ),
    ),
  ]),
  play: async () => {
    const body = within(document.body)
    const panel = (await body.findByRole('heading', { name: 'Log delivery' })).closest('section')!
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Quantity' }), '1{Enter}')
    await expect(await within(panel).findByText('The date is outside every period.')).toBeVisible()
    await expect(within(panel).getByLabelText('Date')).toHaveAttribute('aria-invalid', 'true')
    await expect(body.queryByText('Check the highlighted fields.')).toBeNull()
  },
}

/** Right-click outside the rows: the page's own actions, like every other list. */
export const PageMenu: Story = {
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    fireEvent.contextMenu(body.getByRole('columnheader', { name: 'Period' }))
    const menu = await body.findByRole('menu')
    await expect(within(menu).getByText('Engagements')).toBeVisible()
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['New engagement', 'Import', 'Export CSV', 'Select all', 'View', 'Refresh'])
    await userEvent.click(body.getByRole('menuitem', { name: 'Select all' }))
    await expect(await body.findByRole('toolbar', { name: 'Selected rows' })).toBeVisible()
  },
}
export const PageMenuDark = dark(PageMenu)

/** A member who may only read: rows still select and export, but nothing changes them. */
export const ReadOnlyMember: Story = {
  parameters: pageParameters('/engagements', {}, [
    sessionHandler({ role: 'member', scopes: ['read:*'] }),
  ]),
  play: async (context) => {
    await shows('Bookkeeping support')?.(context)
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Actions for German lessons' }))
    const menu = await body.findByRole('menu')
    await expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
    await expect(within(menu).getByRole('menuitem', { name: 'Open details' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
    await userEvent.click(visible(body.getAllByRole('checkbox', { name: 'Select German lessons' })))
    const toolbar = await bar()
    await expect(within(toolbar).getByRole('button', { name: 'Export CSV' })).toBeVisible()
    await expect(within(toolbar).queryByRole('button', { name: 'Delete' })).toBeNull()
  },
}

/** A new workspace: next to its first action the empty list offers Import, and a drop anywhere works too. */
export const Empty: Story = {
  parameters: emptyList('/engagements', '/api/v1/engagements'),
  play: emptyOffersImport('No engagements yet'),
}
export const EmptyDark = dark(Empty)
export const EmptyPhone = phone(Empty)

/** Files dropped anywhere on the page open its import with them chosen. */
export const DropStartsImport: Story = {
  parameters: emptyList('/engagements', '/api/v1/engagements'),
  play: dropOpensImport(
    'No engagements yet',
    'Drop to read these files into engagements',
    'engagements',
    new File(['%PDF-1.4'], 'contract.pdf', { type: 'application/pdf' }),
  ),
}

/** Whoever may only read has no drop target and no hint. */
export const ReadOnlyNoDrop: Story = {
  parameters: readOnly('/engagements'),
  play: noDropTarget('Bookkeeping support', 'engagements'),
}

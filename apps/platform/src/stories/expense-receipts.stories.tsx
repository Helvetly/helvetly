import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ExpenseDetail } from '@/components/expenses/expense-detail'
import type { Expense, Receipt } from '@/lib/expenses'
import { aiConsent } from '@/mocks/ai-notice'

import { expense } from './pages/api'
import { storySession } from './screen-fixtures'

const ID = 'exp_receipts'
const anna = { id: 'usr_story', name: 'Anna Muster' }

/** A paper receipt drawn as SVG: the same pixels in every run, so the baselines stay stable. */
function receiptImage(shop: string, total: string, items: [string, string][]) {
  const rows = items
    .map(
      ([item, amount], i) =>
        `<text x="40" y="${190 + i * 34}">${item}</text><text x="320" y="${190 + i * 34}" text-anchor="end">${amount}</text>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="560" viewBox="0 0 360 560">
<rect width="360" height="560" fill="#fbfaf7"/>
<g font-family="monospace" font-size="17" fill="#333">
<text x="180" y="70" text-anchor="middle" font-size="22" font-weight="bold">${shop}</text>
<text x="180" y="100" text-anchor="middle" fill="#777">Bahnhofstrasse 1, 8001 Zürich</text>
<line x1="30" y1="140" x2="330" y2="140" stroke="#bbb" stroke-dasharray="6 5"/>
${rows}
<line x1="30" y1="350" x2="330" y2="350" stroke="#bbb" stroke-dasharray="6 5"/>
<text x="40" y="390" font-weight="bold">TOTAL CHF</text><text x="320" y="390" text-anchor="end" font-weight="bold">${total}</text>
<text x="40" y="425" fill="#777">incl. 8.1% VAT</text>
<text x="180" y="500" text-anchor="middle" fill="#777">Merci · Danke · Grazie</text>
</g></svg>`
}

/** A valid one-page PDF, blank, so the preview renders a page. */
function blankPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

const receipt = (id: string, name: string, content_type: string, size: number): Receipt => ({
  id,
  name,
  size,
  content_type,
  created_at: '2026-11-09T14:12:00Z',
  uploaded_by: anna,
})
const cafe = receipt('rcp_cafe', 'PHOTO-2026-11-09-14-12-03.jpg', 'image/jpeg', 293_000)
const taxi = receipt('rcp_taxi', 'taxi-zurich-airport.png', 'image/png', 184_000)
const hotel = receipt('rcp_hotel', 'hotel-invoice-1142.pdf', 'application/pdf', 61_000)
const images: Record<string, string> = {
  rcp_cafe: receiptImage('SBB CFF FFS', '184.60', [
    ['Zürich HB – Bern', '92.30'],
    ['Bern – Zürich HB', '92.30'],
  ]),
  rcp_taxi: receiptImage('TAXI 444 AG', '68.00', [['Ride Bern Bahnhof', '68.00']]),
}

const draft = (receipts: Receipt[]): Expense =>
  expense({
    id: ID,
    number: 7,
    status: 'draft',
    receipts_count: receipts.length,
    is_complete: receipts.length > 0,
    missing_fields: receipts.length > 0 ? [] : ['receipt'],
    booked_at: null,
    booked_by: null,
  })

/**
 * The API for one expense whose receipts change: completeness follows them, as the server derives it on
 * every read. `start` resets it, so a rerun of a story begins from the same receipts.
 */
function receiptApi(initial: Receipt[], upload: () => Promise<void> = async () => {}) {
  let receipts = [...initial]
  const handlers = [
    http.get('/api/v1/session', () => HttpResponse.json(storySession)),
    http.get(`/api/v1/expenses/${ID}`, () => HttpResponse.json({ data: draft(receipts) })),
    http.get(`/api/v1/expenses/${ID}/receipts`, () => HttpResponse.json({ data: receipts })),
    http.get(`/api/v1/expenses/${ID}/receipts/:receipt`, ({ params }) => {
      const id = String(params.receipt)
      if (id === hotel.id)
        return HttpResponse.text(blankPdf(), { headers: { 'Content-Type': 'application/pdf' } })
      return HttpResponse.text(images[id] ?? images.rcp_cafe, {
        headers: { 'Content-Type': 'image/svg+xml' },
      })
    }),
    http.post(`/api/v1/expenses/${ID}/receipts`, async () => {
      await upload()
      const added = receipt('rcp_new', 'migros-2026-11-10.jpg', 'image/jpeg', 120_000)
      receipts = [added, ...receipts]
      return HttpResponse.json({ data: [added] }, { status: 201 })
    }),
    http.delete(`/api/v1/expenses/${ID}/receipts/:receipt`, ({ params }) => {
      receipts = receipts.filter((entry) => entry.id !== params.receipt)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { handlers, start: () => void (receipts = [...initial]) }
}

const meta = {
  title: 'Expenses/Receipts',
  parameters: { layout: 'fullscreen' },
  args: { onCommand: fn(), onClose: fn() },
  render: (args) => (
    <ExpenseDetail id={ID} canManage onClose={args.onClose} onCommand={args.onCommand} />
  ),
} satisfies Meta<{ onCommand: () => void; onClose: () => void }>
export default meta
type Story = StoryObj<typeof meta>

const dark = (base: Story): Story => ({ ...base, parameters: { ...base.parameters, dark: true } })
const phone = (base: Story): Story => ({ ...base, globals: { viewport: { value: 'phone' } } })

const drawer = async (canvasElement: HTMLElement) =>
  within(await within(canvasElement.ownerDocument.body).findByRole('dialog'))

const story = (api: ReturnType<typeof receiptApi>, play: Story['play']): Story => ({
  beforeEach: api.start,
  parameters: { msw: { handlers: api.handlers } },
  play,
})

/** One photo: a preview card with the file as its caption; the expense is ready and Book is on. */
export const OneReceipt = story(receiptApi([cafe]), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  await expect(await sheet.findByText(cafe.name)).toBeVisible()
  await expect(sheet.getByText('Ready to book')).toBeVisible()
  await expect(sheet.queryByText('Not ready to book')).toBeNull()
  await expect(sheet.getByRole('button', { name: 'Book' })).toBeEnabled()
  await expect(sheet.getByRole('button', { name: `Delete ${cafe.name}` })).toBeVisible()
  await expect(sheet.getByRole('link', { name: `Download ${cafe.name}` })).toBeVisible()
  // The strip: the one thumbnail, then the tile that adds more.
  const strip = sheet.getByRole('list', { name: 'All receipts' })
  await expect(within(strip).getAllByRole('listitem')).toHaveLength(2)
  await expect(within(strip).getByLabelText('Add another receipt')).toBeInTheDocument()
})

/** Clicking the photo opens it full size; zoom steps up and down, Escape closes. */
export const FullSizeViewer = story(receiptApi([cafe, taxi]), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  await userEvent.click(await sheet.findByRole('button', { name: `Open ${cafe.name} full size` }))
  const body = within(canvasElement.ownerDocument.body)
  const viewer = await body.findByRole('dialog', { name: cafe.name })
  const view = within(viewer)
  await expect(view.getByText('100%')).toBeVisible()
  await expect(view.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  await userEvent.click(view.getAllByRole('button', { name: 'Zoom in' })[0] as HTMLElement)
  await expect(view.getByText('150%')).toBeVisible()
  await expect(view.getByText('1 / 2')).toBeVisible()
  await userEvent.click(view.getByRole('button', { name: 'Next receipt' }))
  await expect(await body.findByRole('dialog', { name: taxi.name })).toBeVisible()
  await expect(view.getByText('100%')).toBeVisible()
  await userEvent.click(view.getByRole('button', { name: 'Close' }))
  // The dialog leaves after its closing animation, which a busy CI runner can stretch past a second.
  await waitFor(() => expect(body.queryByRole('dialog', { name: taxi.name })).toBeNull(), {
    timeout: 5000,
  })
  // The card now shows the receipt the viewer ended on.
  await expect(sheet.getByText(taxi.name)).toBeVisible()
})

/** Several receipts: a thumbnail strip; choosing one shows it in the card. */
export const SeveralReceipts = story(receiptApi([cafe, taxi, hotel]), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  const strip = await sheet.findByRole('list', { name: 'All receipts' })
  const thumbs = within(strip).getAllByRole('button')
  await expect(thumbs).toHaveLength(3)
  await expect(thumbs[0]).toHaveAttribute('aria-pressed', 'true')
  await expect(within(strip).getByText('PDF')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Book' })).toBeEnabled()
})

export const SeveralReceiptsChooseAnother = story(
  receiptApi([cafe, taxi, hotel]),
  async ({ canvasElement }) => {
    const sheet = await drawer(canvasElement)
    await userEvent.click(await sheet.findByRole('button', { name: `Show ${taxi.name}` }))
    await expect(sheet.getByRole('button', { name: `Show ${taxi.name}` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(sheet.getByRole('button', { name: `Open ${taxi.name} full size` })).toBeVisible()
  },
)

/** A PDF receipt previews its pages in the card. */
export const PdfReceipt = story(receiptApi([hotel]), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  const viewer = await sheet.findByRole('document')
  await waitFor(() => expect(viewer.querySelectorAll('canvas')).toHaveLength(1))
  await expect(sheet.getByText(hotel.name)).toBeVisible()
})

/**
 * No receipt yet: the notice names what is missing as actions, Book waits, the drop zone asks for the file.
 * The "Receipt" action opens the file chooser of the drop zone.
 */
export const MissingReceipt = story(receiptApi([]), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  await expect(await sheet.findByText('Not ready to book')).toBeVisible()
  await expect(sheet.getByText('Incomplete')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Book' })).toBeDisabled()
  const input = await sheet.findByLabelText('Upload receipts')
  const opened = fn()
  input.addEventListener('click', (event) => {
    event.preventDefault()
    opened()
  })
  const missing = sheet.getByRole('list', { name: 'Missing:' })
  await userEvent.click(within(missing).getByRole('button', { name: 'Receipt' }))
  await expect(opened).toHaveBeenCalledOnce()
})

/** While the files upload, the drop zone waits and shows the progress. */
export const Uploading = story(
  receiptApi([], () => delay('infinite')),
  async ({ canvasElement }) => {
    const sheet = await drawer(canvasElement)
    await userEvent.upload(
      await sheet.findByLabelText('Upload receipts'),
      new File(['jpeg'], 'migros-2026-11-10.jpg', { type: 'image/jpeg' }),
    )
    await expect(await sheet.findByText('Uploading migros-2026-11-10.jpg…')).toBeVisible()
    await expect(sheet.getByLabelText('Upload receipts')).toBeDisabled()
  },
)

/** The bug this block was rebuilt for: an uploaded receipt makes the expense ready at once, Book included. */
export const UploadMakesReady = story(receiptApi([]), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  await expect(await sheet.findByText('Incomplete')).toBeVisible()
  await userEvent.upload(
    await sheet.findByLabelText('Upload receipts'),
    new File(['jpeg'], 'migros-2026-11-10.jpg', { type: 'image/jpeg' }),
  )
  await expect(await sheet.findByText('Ready to book')).toBeVisible()
  await expect(sheet.queryByText('Not ready to book')).toBeNull()
  await expect(sheet.getByRole('button', { name: 'Book' })).toBeEnabled()
  await expect(sheet.getByText('migros-2026-11-10.jpg')).toBeVisible()
})

/** Adding another receipt keeps it ready; deleting every receipt makes it incomplete again. */
export const AddAnotherThenDeleteAll = story(receiptApi([cafe]), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  await userEvent.upload(
    await sheet.findByLabelText('Add another receipt'),
    new File(['jpeg'], 'migros-2026-11-10.jpg', { type: 'image/jpeg' }),
  )
  const strip = sheet.getByRole('list', { name: 'All receipts' })
  await waitFor(() => expect(within(strip).getAllByRole('button')).toHaveLength(2))
  await expect(sheet.getByText('Ready to book')).toBeVisible()
  const body = within(canvasElement.ownerDocument.body)
  const remove = async (name: string) => {
    await userEvent.click(await sheet.findByRole('button', { name: `Delete ${name}` }))
    await userEvent.click(await body.findByRole('button', { name: 'Delete receipt' }))
    await waitFor(() => expect(sheet.queryByRole('button', { name: `Delete ${name}` })).toBeNull())
  }
  await remove('migros-2026-11-10.jpg')
  await expect(await sheet.findByText('Ready to book')).toBeVisible()
  await remove(cafe.name)
  await expect(await sheet.findByText('Not ready to book')).toBeVisible()
  await expect(sheet.getByText('Incomplete')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Book' })).toBeDisabled()
  await expect(sheet.getByLabelText('Upload receipts')).toBeInTheDocument()
})

/** The draft's receipts read again: an SBB receipt with a number the draft lacks and a longer supplier name. */
const rereading = {
  supplier: { name: 'SBB CFF FFS AG', vat_number: null, country: 'CH', iban: null },
  document: { type: 'receipt', number: 'R-77', date: '2026-11-04', due_date: null },
  description: 'Zürich–Bern return',
  currency: 'CHF',
  totals: { net: null, vat: null, gross: '184.60' },
  vat_breakdown: [{ rate: '8.1', net: null, vat: null, gross: '184.60' }],
  items: [],
  payment: { status: 'unknown', method: null, paid_on: null },
  reverse_charge: false,
  category: null,
  confidence: {
    supplier: 'high',
    document: 'high',
    totals: 'high',
    vat_breakdown: 'high',
    items: 'high',
    payment: 'high',
  },
  issues: {},
}
const patched = fn()
const rereadApi = (status: Expense['status'] = 'draft') => {
  const api = receiptApi([cafe])
  const current = (): Expense => ({
    ...draft([cafe]),
    status,
    booked_at: status === 'draft' ? null : '2026-11-05T09:00:00Z',
  })
  return {
    start: () => void (api.start(), patched.mockClear()),
    handlers: [
      http.get(`/api/v1/expenses/${ID}`, () => HttpResponse.json({ data: current() })),
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
      http.post(`/api/v1/expenses/${ID}/read`, () => HttpResponse.json({ data: rereading })),
      http.patch(`/api/v1/expenses/${ID}`, async ({ request }) => {
        const input = await request.json()
        patched(input)
        return HttpResponse.json({ data: { ...current(), reference: 'R-77' } })
      }),
      ...api.handlers,
    ],
  }
}

/**
 * Read again: what the receipt says beside what the draft has; the empty receipt number is ticked, the changed
 * supplier name is not. Nothing is saved yet.
 */
export const RereadDiff = story(rereadApi(), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  await userEvent.click(await sheet.findByRole('button', { name: 'Read again with AI' }))
  const list = await sheet.findByRole('list', { name: 'Differences' })
  const boxes = within(list).getAllByRole('checkbox')
  await expect(boxes).toHaveLength(2)
  await expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
    /Supplier.*SBB CFF FFS.*SBB CFF FFS AG/,
  )
  await expect(boxes[0]).not.toBeChecked()
  await expect(boxes[1]).toBeChecked()
  await expect(sheet.getByRole('button', { name: 'Apply 1 change' })).toBeEnabled()
  await expect(patched).not.toHaveBeenCalled()
})
export const RereadDiffDark = dark(RereadDiff)
export const RereadDiffPhone = phone(RereadDiff)

/** Applying saves only what is ticked, as an ordinary edit, and goes back to the expense. */
export const RereadDiffApply = story(rereadApi(), async (context) => {
  await RereadDiff.play?.(context)
  const sheet = await drawer(context.canvasElement)
  await userEvent.click(sheet.getByRole('button', { name: 'Apply 1 change' }))
  await waitFor(() => expect(patched).toHaveBeenCalledOnce())
  await expect(patched.mock.calls[0]?.[0]).toMatchObject({
    reference: 'R-77',
    supplier_name: 'SBB CFF FFS',
  })
  await expect(await sheet.findByText('Ready to book')).toBeVisible()
})

/** A booked expense's figures are records: nothing offers to read its receipt again. */
export const BookedHasNoReread = story(rereadApi('booked'), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  await expect(await sheet.findByText(cafe.name)).toBeVisible()
  await expect(sheet.queryByRole('button', { name: 'Read again with AI' })).toBeNull()
  await userEvent.click(sheet.getByRole('button', { name: 'More actions' }))
  const body = within(canvasElement.ownerDocument.body)
  await expect(await body.findByRole('menuitem', { name: 'Duplicate' })).toBeVisible()
  await expect(body.queryByRole('menuitem', { name: 'Read again with AI' })).toBeNull()
})

/** Below the receipt: the amounts, supplier, payment and booking cards, with the entries booking will make. */
export const DetailCards = story(receiptApi([cafe]), async ({ canvasElement }) => {
  const sheet = await drawer(canvasElement)
  await expect(await sheet.findByRole('heading', { name: 'Amounts' })).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Supplier & document' })).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Payment' })).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Booking' })).toBeVisible()
  await expect(sheet.getByText('You reclaim CHF 13.83 input tax')).toBeVisible()
  await expect(sheet.getByText('Entries booking will make')).toBeVisible()
  await expect(sheet.getByRole('cell', { name: '1171' })).toBeVisible()
  await expect(sheet.getAllByRole('cell', { name: '2000' })).toHaveLength(2)
})
export const DetailCardsDark = dark(DetailCards)
/** On a phone (in Storybook and the visual suite) the cards stack and Book stays at the bottom of the screen. */
export const DetailCardsPhone = phone(DetailCards)

/** The drawer's "…" offers the payment toggle for the expense's current state: paid here, so Mark unpaid. */
export const MenuTogglesPayment = story(receiptApi([cafe]), async ({ canvasElement, args }) => {
  const sheet = await drawer(canvasElement)
  await userEvent.click(await sheet.findByRole('button', { name: 'More actions' }))
  const body = within(canvasElement.ownerDocument.body)
  await expect(body.queryByRole('menuitem', { name: /Mark paid/ })).toBeNull()
  await userEvent.click(await body.findByRole('menuitem', { name: /Mark unpaid/ }))
  await expect(args.onCommand).toHaveBeenCalledWith(
    'mark_unpaid',
    expect.objectContaining({ id: ID }),
  )
})

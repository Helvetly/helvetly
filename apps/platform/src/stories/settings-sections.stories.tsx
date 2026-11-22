import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { CompanySettingsPage, InvoiceSettingsPage } from '@/components/settings/invoice-settings'
import type { SettingsInput } from '@/lib/invoices'
import { legalFormsHandler, nextNumbersHandler, sampleSettings } from '@/test/invoice-api'

const session = {
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role: 'owner',
  scopes: ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
}

const sent: SettingsInput[] = []
const lastSent = () => sent.at(-1)

const handlers = (put: Parameters<typeof http.put>[1]) => [
  http.get('/api/v1/session', () => HttpResponse.json(session)),
  // Missing the IBAN: the readiness card says so until the bank account is saved.
  http.get('/api/v1/invoice-settings', () =>
    HttpResponse.json({ data: sampleSettings({ iban: null }) }),
  ),
  http.put('/api/v1/invoice-settings', put),
  legalFormsHandler,
  nextNumbersHandler,
]

const saving = async ({ request }: { request: Request }) => {
  const body: SettingsInput = await request.json()
  sent.push(body)
  await delay(150)
  return HttpResponse.json({ data: sampleSettings() })
}

/** What a utility class (text-success, bg-warning-solid…) paints in this page, as the browser's computed colour. */
const painted = (near: Element, className: string, property: 'color' | 'backgroundColor') => {
  const probe = document.createElement('span')
  probe.className = className
  near.append(probe)
  const color = getComputedStyle(probe)[property]
  probe.remove()
  return color
}

const meta = {
  title: 'Settings/Section save',
  parameters: { layout: 'fullscreen', msw: { handlers: handlers(saving) } },
  render: () => (
    <SidebarProvider>
      <div className="min-w-0 flex-1">
        <InvoiceSettingsPage />
      </div>
      <Toaster />
    </SidebarProvider>
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const region = async (canvas: HTMLElement, name: string) =>
  within(await within(canvas).findByRole('region', { name }))

/** Edit → Save turns on → Saving… → Saved; another section's edit stays unsaved and is not sent. */
export const SaveOneSection: Story = {
  render: () => (
    <SidebarProvider>
      <CompanySettingsPage />
      <Toaster />
    </SidebarProvider>
  ),
  play: async ({ canvasElement }) => {
    sent.length = 0
    const page = within(canvasElement)
    const iban = await page.findByLabelText(/^IBAN/)
    const bank = await region(canvasElement, 'Bank account')
    const company = await region(canvasElement, 'Company')
    // Nothing to save yet: the section shows no Save bar.
    await expect(bank.queryByRole('button', { name: 'Save' })).toBeNull()
    await expect(page.getByText('Still needed:')).toBeVisible()

    await userEvent.type(iban, 'CH9300762011623852957')
    await userEvent.type(company.getByLabelText(/^Apt/), 'Suite 4')
    await expect(bank.getByText('Unsaved changes')).toBeVisible()
    // Unsaved is orange, text and dot; its bar stays inside the 44rem form, not out to the far column.
    const unsaved = bank.getByText('Unsaved changes')
    await expect(getComputedStyle(unsaved).color).toBe(painted(unsaved, 'text-warning', 'color'))
    const dot = unsaved.firstElementChild
    if (!dot) throw new Error('The unsaved status has no dot')
    await expect(getComputedStyle(dot).backgroundColor).toBe(
      painted(unsaved, 'bg-warning-solid', 'backgroundColor'),
    )
    const bar = bank.getByText('Unsaved changes').closest('[data-slot="settings-section-footer"]')
    await expect(bar?.getBoundingClientRect().width).toBeLessThanOrEqual(44 * 16 + 1)
    // The page header's hairline reaches both edges of the panel.
    const pageBox = canvasElement
      .querySelector('[data-slot="settings-page"]')
      ?.getBoundingClientRect()
    const headBox = canvasElement
      .querySelector('[data-slot="settings-page-header"]')
      ?.getBoundingClientRect()
    await expect(Math.round(headBox?.left ?? -1)).toBe(Math.round(pageBox?.left ?? -2))
    await expect(Math.round(headBox?.right ?? -1)).toBe(Math.round(pageBox?.right ?? -2))
    // The section nav (a sidebar on wide screens, a row of chips on narrow ones) marks it too.
    await expect(
      page.getByRole('button', { name: /^Bank account.*unsaved changes/i }),
    ).toBeVisible()

    await userEvent.click(bank.getByRole('button', { name: 'Save' }))
    await expect(await bank.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    await expect(await bank.findByText('Saved')).toBeVisible()
    const saved = await bank.findByText('Saved')
    await expect(getComputedStyle(saved).color).toBe(painted(saved, 'text-success', 'color'))
    await expect(lastSent()?.iban).toBe('CH93 0076 2011 6238 5295 7')
    await expect(lastSent()?.seller?.apt).toBeNull() // the company's edit was not part of this save
    await expect(await within(document.body).findAllByText('Bank account saved.')).not.toHaveLength(
      0,
    ) // the toast
    await expect(page.getByText(/invoices can be issued/)).toBeVisible() // readiness follows the save
    await expect(company.getByText('Unsaved changes')).toBeVisible()
    await waitFor(() => expect(bank.queryByText('Saved')).toBeNull(), { timeout: 3000 })
    await expect(bank.queryByRole('button', { name: 'Save' })).toBeNull()
  },
}

export const SaveOneSectionDark: Story = { ...SaveOneSection, parameters: { dark: true } }

/** A refused save keeps the edits, marks the field and says so in a toast. */
export const SaveRefused: Story = {
  render: () => (
    <SidebarProvider>
      <CompanySettingsPage />
      <Toaster />
    </SidebarProvider>
  ),
  parameters: {
    msw: {
      handlers: handlers(() =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_failed',
              message: 'Check the highlighted fields.',
              details: { fields: { 'seller.city': 'Enter the city as on your register entry.' } },
            },
          },
          { status: 422 },
        ),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const company = await region(canvasElement, 'Company')
    const city = await company.findByLabelText(/^City/)
    await userEvent.clear(city)
    await userEvent.type(city, 'Zurich')
    await userEvent.click(company.getByRole('button', { name: 'Save' }))
    await expect(
      await company.findByText('Enter the city as on your register entry.'),
    ).toBeVisible()
    await expect(
      await within(document.body).findByText('Couldn’t save: check the highlighted fields.'),
    ).toBeInTheDocument() // the toast
    await expect(city).toHaveValue('Zurich')
    await expect(company.getByText('Unsaved changes')).toBeVisible()
    await expect(company.getByRole('button', { name: 'Save' })).toBeEnabled()
  },
}

/** A custom number format: placeholders go in at the cursor, the next numbers follow it, and a format without
 * the running number is refused before anything is sent. */
export const CustomNumberFormat: Story = {
  play: async ({ canvasElement }) => {
    sent.length = 0
    const numbering = await region(canvasElement, 'Numbering')
    await userEvent.click(numbering.getByRole('button', { name: /Number format/ }))
    await userEvent.click(
      await within(document.body).findByRole('option', { name: /Custom format/ }),
    )
    const field = numbering.getByRole('textbox', { name: 'Custom format' })
    await userEvent.clear(field)
    await userEvent.type(field, 'FV-')
    const placeholders = within(numbering.getByRole('group', { name: 'Insert a placeholder' }))
    await userEvent.click(placeholders.getByRole('button', { name: /{TYPE}/ }))
    await userEvent.click(numbering.getByRole('button', { name: 'Save' }))
    await expect(
      await numbering.findByText('Put the running number in exactly once.'),
    ).toBeVisible()
    await expect(sent).toHaveLength(0)
    await userEvent.type(field, '-')
    await userEvent.click(placeholders.getByRole('button', { name: /{YYYY}/ }))
    await userEvent.type(field, '-')
    await userEvent.click(placeholders.getByRole('button', { name: /{NNN}/ }))
    const year = new Date().getFullYear()
    const preview = numbering.getByRole('status', { name: 'Next numbers' })
    await waitFor(() => expect(preview).toHaveTextContent(`FV-INV-${year}-042`))
    await expect(preview).toHaveTextContent(`FV-Q-${year}-007`)
    await expect(preview).toHaveTextContent(`FV-CN-${year}-003`)
    await expect(preview).toHaveTextContent(
      /Debit note.*Prepayment.*Proforma.*Corrected invoice.*Self-billed/s,
    )
    await userEvent.click(numbering.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lastSent()?.number_format).toBe('FV-{TYPE}-{YYYY}-{NNN}'))
  },
}

/** The next-number rows never overlap one another or leave the list: two columns of four on a wide screen, one on a phone. */
async function expectRowsApart(canvasElement: HTMLElement, columns: number) {
  const numbering = await region(canvasElement, 'Numbering')
  const preview = await numbering.findByRole('status', { name: 'Next numbers' })
  await waitFor(() => expect(preview).toHaveTextContent('042'))
  const rows = [...preview.querySelectorAll('[data-slot="settings-preview-row"]')]
  await expect(rows).toHaveLength(8)
  const lefts = () => new Set(rows.map((row) => Math.round(row.getBoundingClientRect().left)))
  await waitFor(() => expect(lefts().size).toBe(columns)) // the story's viewport applies after the first paint
  const box = preview.getBoundingClientRect()
  const rects = rows.map((row) => row.getBoundingClientRect())
  const format = numbering.getByRole('button', { name: /Number format/ }).getBoundingClientRect()
  expect(format.bottom).toBeLessThanOrEqual(box.top) // the list sits below the select
  for (const [i, a] of rects.entries()) {
    expect(a.left).toBeGreaterThanOrEqual(box.left)
    expect(a.right).toBeLessThanOrEqual(box.right + 0.5)
    for (const b of rects.slice(i + 1)) {
      const apart = a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5 || a.right <= b.left + 0.5
      expect(apart).toBe(true)
    }
  }
  for (const row of rows) {
    const [label, value] = row.children
    expect(label?.getBoundingClientRect().right).toBeLessThanOrEqual(
      (value?.getBoundingClientRect().left ?? 0) + 0.5,
    )
    expect(value?.scrollWidth).toBeLessThanOrEqual(value?.clientWidth ?? 0)
  }
}

export const NextNumbersRows: Story = {
  parameters: {
    viewport: {
      options: { desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } } },
    },
  },
  globals: { viewport: { value: 'desktop' } },
  play: async ({ canvasElement }) => expectRowsApart(canvasElement, 2),
}

export const NextNumbersRowsPhone: Story = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '360px', height: '780px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => expectRowsApart(canvasElement, 1),
}

/** Discard puts the section back as saved. */
export const DiscardSection: Story = {
  play: async ({ canvasElement }) => {
    sent.length = 0
    const numbering = await region(canvasElement, 'Numbering')
    const preview = await numbering.findByRole('status', { name: 'Next numbers' })
    await waitFor(() => expect(preview).toHaveTextContent('042')) // the counters are read
    const before = preview.textContent
    await userEvent.click(numbering.getByRole('button', { name: /Number format/ }))
    const list = await within(document.body).findByRole('listbox')
    const options = within(list).getAllByRole('option')
    const other = options.find((option) => option.getAttribute('aria-selected') !== 'true')
    if (!other) throw new Error('Only one number format')
    await userEvent.click(other)
    await waitFor(() => expect(preview.textContent).not.toBe(before))
    await expect(numbering.getByRole('button', { name: 'Save' })).toBeEnabled()
    await userEvent.click(numbering.getByRole('button', { name: 'Discard' }))
    await expect(preview.textContent).toBe(before)
    await expect(numbering.queryByRole('button', { name: 'Save' })).toBeNull()
    await expect(numbering.queryByText('Unsaved changes')).toBeNull()
    await expect(sent).toHaveLength(0)
  },
}

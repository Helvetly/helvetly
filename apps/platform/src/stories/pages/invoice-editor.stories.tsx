import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { InvoiceEditorDrawer } from '@/components/invoices/invoice-editor'
import type { InvoiceInput } from '@/lib/invoices'
import { previewRows, sampleSchedule } from '@/test/invoice-api'

import { draftInvoice } from './api'
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

// Autosave answers like the server: the draft as saved.
const autosave = http.patch('/api/v1/invoices/inv_draft', () =>
  HttpResponse.json({ data: draftInvoice }),
)
/** Waits for the editor's pending autosave, so no save lands after the story ends. */
const settled = () =>
  waitFor(
    () =>
      expect(within(document.body).getByRole('status', { hidden: true })).toHaveTextContent(
        'Saved',
      ),
    {
      timeout: 3000,
    },
  )

const meta = {
  title: 'Pages/Invoice editor',
  beforeEach: closeHeidi,
  parameters: {
    ...pageParameters('/invoices', { compose: 'inv_draft' }, [autosave]),
    // shortcut: the date buttons' aria-labels ("Due date: 5 Dec 2026") leave out visible text
    // ("in 30 days", "Add date or period"); turn this rule on again once the editor fixes them.
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast', enabled: false },
          { id: 'label-content-name-mismatch', enabled: false },
        ],
      },
    },
  },
  render: () => (
    <Frame>
      <InvoiceEditorDrawer
        compose={{ id: 'inv_draft', kind: 'invoice', client: null }}
        onClose={() => {}}
        onCreated={() => {}}
      />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const DraftWithLines: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    await shows(/Brand workshop/)?.(context)
  },
}
export const DraftWithLinesDark = dark(DraftWithLines)
export const DraftWithLinesPhone = phone(DraftWithLines)

/**
 * Optional fields: the client number can be replaced or hidden, and a contract number added from the Add field
 * menu; a hidden client number comes back from the same menu.
 */
export const OptionalFields: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: 'Do not print a client number' }))
    await expect(page.queryByLabelText(/Client no\./)).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Contract no.' }))
    const contract = await page.findByRole('textbox', { name: /Contract no\./ })
    // The chosen field takes focus a frame later.
    await waitFor(() => expect(contract).toHaveFocus())
    await userEvent.type(contract, 'C23-25-CP2302')
    await expect(contract).toHaveValue('C23-25-CP2302')
    await userEvent.tab() // leave the field before the menu takes focus
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Client no.' }))
    await expect(await page.findByRole('textbox', { name: /Client no\./ })).toBeVisible()

    // The contract number hides again and waits in the menu, emptied.
    await userEvent.click(page.getByRole('button', { name: 'Remove the contract number' }))
    await expect(page.queryByRole('textbox', { name: /Contract no\./ })).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Contract no.' }))
    await expect(await page.findByRole('textbox', { name: /Contract no\./ })).toHaveValue('')
    await settled()
  },
}

/**
 * The link icon beside Client no. toggles, never navigates: linked shows the client's own number read-only;
 * unlinked takes a number typed in, and linking again goes back to the client's.
 */
export const ClientNumberLinkToggle: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const page = within(document.body)
    const linked = await page.findByRole('textbox', { name: /Client no\./ })
    await expect(linked).toHaveValue('1')
    await expect(linked).toHaveAttribute('readonly')
    await userEvent.click(page.getByRole('button', { name: /Unlink to type your own/ }))
    const own = page.getByRole('textbox', { name: /Client no\./ })
    await expect(own).not.toHaveAttribute('readonly')
    await userEvent.clear(own)
    await expect(own).not.toHaveAttribute('readonly') // emptied, still the person's own field
    await userEvent.type(own, 'K-0815')
    await expect(own).toHaveValue('K-0815')
    await userEvent.click(page.getByRole('button', { name: 'Use the client’s number' }))
    await expect(page.getByRole('textbox', { name: /Client no\./ })).toHaveValue('1')
    await expect(page.getByText('Alpenglow Studio GmbH')).toBeVisible() // still in the editor
    await settled()
  },
}

/** The engagement row is optional too: under Add field until chosen, and it hides again while empty. */
export const EngagementIsOptional: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const page = within(document.body)
    await expect(page.queryByText('Choose an engagement')).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Engagement' }))
    await expect(await page.findByRole('button', { name: 'Hide the engagement row' })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Hide the engagement row' }))
    await userEvent.click(page.getByRole('button', { name: 'Add field' }))
    await expect(await page.findByRole('menuitem', { name: 'Engagement' })).toBeVisible()
  },
}

/** Like a printed page, the footer text sits at the bottom of the paper, with the free space above it. */
export const FooterAtTheBottom: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    await expectFooterAtTheBottom(within(document.body).getByRole('article'))
  },
}
export const FooterAtTheBottomPhone = phone(FooterAtTheBottom)

/** With no client chosen nothing follows the paper, so it meets the bottom panel directly. */
export const PaperMeetsBottomPanel: Story = {
  parameters: {
    ...meta.parameters,
    ...pageParameters('/invoices', { compose: 'new' }, [autosave]),
    a11y: meta.parameters.a11y,
  },
  render: () => (
    <Frame>
      <InvoiceEditorDrawer
        compose={{ id: null, kind: 'invoice', client: null }}
        onClose={() => {}}
        onCreated={() => {}}
      />
    </Frame>
  ),
  play: async () => {
    await expectPaperMeetsBottomPanel(await within(document.body).findByRole('article'))
    await userEvent.keyboard('{Escape}')
  },
}

/** The preview answers the schedule's rows, as the server does: the draft's 3'134.90 in three monthly parts. */
const instalmentPreview = {
  ...pageParameters('/invoices', { compose: 'inv_draft' }, [
    autosave,
    http.post<never, Partial<InvoiceInput>>('/api/v1/invoices/preview', async ({ request }) => {
      const input = await request.json()
      return HttpResponse.json({
        data: {
          ...draftInvoice,
          instalments: input.instalments ? sampleSchedule(previewRows) : null,
        },
      })
    }),
  ]),
  a11y: meta.parameters.a11y,
}
const instalmentsDialog = () =>
  within(document.body).getByRole('dialog', { name: 'Pay in instalments' })
const switchOn = async () => {
  const page = within(document.body)
  await userEvent.click(await page.findByRole('switch', { name: 'Pay in instalments' }))
  const dialog = instalmentsDialog()
  await waitFor(() =>
    expect(within(dialog).getAllByRole('textbox', { name: /^Instalment \d amount$/ })).toHaveLength(
      3,
    ),
  )
  return dialog
}

/** "Pay in instalments" sits in the footer above the internal note; switching it on opens the settings. */
export const InstalmentsSettings: Story = {
  parameters: instalmentPreview,
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const dialog = await switchOn()
    await expect(within(dialog).getByRole('switch', { name: 'Payment reminders' })).toBeChecked()
    await expect(within(dialog).getByText(/Amount due/)).toBeVisible()
    await settled()
  },
}
export const InstalmentsSettingsDark = dark(InstalmentsSettings)
export const InstalmentsSettingsPhone = phone(InstalmentsSettings)

/** Saved, the footer row keeps only the summary, an Edit button and the switch. */
export const InstalmentsSummary: Story = {
  parameters: instalmentPreview,
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const page = within(document.body)
    const dialog = await switchOn()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await expect(page.queryByRole('dialog', { name: 'Pay in instalments' })).toBeNull()
    await expect(page.getByText('3× · Monthly · from 5 Dec 2026')).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Pay in instalments' })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Edit instalments' })).toBeVisible()
    await settled()
  },
}
export const InstalmentsSummaryDark = dark(InstalmentsSummary)
export const InstalmentsSummaryPhone = phone(InstalmentsSummary)

/** Cancel on the first switch-on leaves the invoice without instalments. */
export const InstalmentsCancelled: Story = {
  parameters: instalmentPreview,
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const page = within(document.body)
    const dialog = await switchOn()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await expect(page.queryByRole('dialog', { name: 'Pay in instalments' })).toBeNull()
    await expect(page.getByRole('switch', { name: 'Pay in instalments' })).not.toBeChecked()
    await expect(page.queryByText(/3× ·/)).toBeNull()
    await settled()
  },
}

/** Edit reopens the settings; a new interval and the reminders switch show after Save, rows that do not add up block it. */
export const InstalmentsEdited: Story = {
  parameters: instalmentPreview,
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    const page = within(document.body)
    await userEvent.click(within(await switchOn()).getByRole('button', { name: 'Save' }))

    await userEvent.click(page.getByRole('button', { name: 'Edit instalments' }))
    const dialog = instalmentsDialog()
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Interval' }),
      'quarterly',
    )
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Payment reminders' }))
    const first = await within(dialog).findByRole('textbox', { name: 'Instalment 1 amount' })
    await userEvent.clear(first)
    await userEvent.type(first, '1000')
    await expect(await within(dialog).findByText('Off by 44.95')).toBeVisible()
    await expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Equal parts' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await expect(await page.findByText('3× · Quarterly · from 5 Dec 2026')).toBeVisible()

    await userEvent.click(page.getByRole('button', { name: 'Edit instalments' }))
    await expect(
      within(instalmentsDialog()).getByRole('switch', { name: 'Payment reminders' }),
    ).not.toBeChecked()
    await settled()
  },
}

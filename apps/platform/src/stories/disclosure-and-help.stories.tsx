import { Disclosure } from '@helvetly/ui/components/disclosure'
import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { PencilLine } from 'lucide-react'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { CompanySettingsPage } from '@/components/settings/invoice-settings'
import { GeneralCard } from '@/components/settings/workspace-settings'
import { sampleSettings } from '@/test/invoice-api'

const session = {
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role: 'owner',
  scopes: ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
}

const meta = {
  title: 'Design system/Disclosure and help',
  parameters: {
    msw: { handlers: [http.get('/api/v1/session', () => HttpResponse.json(session))] },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A collapsible reads as one: tinted bordered row, count badge, turning chevron, sub-panel. */
export const Disclosures: Story = {
  render: () => (
    <div className="grid max-w-xl gap-3 rounded-xl bg-card p-5">
      <Disclosure
        icon={PencilLine}
        label="Lines to fill in yourself"
        count={3}
        description="Not recorded in Helvetly. Add them in the ePortal if they apply."
      >
        <ul className="grid gap-1 py-1 pr-3 text-[13px]">
          <li>235 · Reductions of consideration</li>
          <li>280 · Miscellaneous</li>
          <li>225 · Transfers under the notification procedure</li>
        </ul>
      </Disclosure>
      <Disclosure label="How do I cancel?" defaultOpen>
        <p className="py-2.5 pr-4 pl-3.5 text-[13.5px] text-muted-foreground">
          In Plan & billing, under Manage billing.
        </p>
      </Disclosure>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [lines, faq] = [...canvasElement.querySelectorAll('details')]
    await expect(lines).not.toHaveAttribute('open')
    await expect(faq).toHaveAttribute('open')
    await expect(
      canvas.getByText('Reductions of consideration', { exact: false }),
    ).not.toBeVisible()
    await userEvent.tab()
    await expect(lines?.querySelector('summary')).toHaveFocus()
    // A native summary: the browser toggles it on Enter; synthetic keys do not, so click.
    await userEvent.click(canvas.getByText('Lines to fill in yourself'))
    await expect(lines).toHaveAttribute('open')
    await expect(canvas.getByText('Reductions of consideration', { exact: false })).toBeVisible()
    await userEvent.click(canvas.getByText('Lines to fill in yourself'))
    await expect(lines).not.toHaveAttribute('open')
    await expect(canvas.getByText('3')).toBeVisible()
  },
}

export const DisclosuresDark: Story = { ...Disclosures, parameters: { dark: true } }

/** The time zone's explanation sits behind a (?) beside the label, not as a paragraph below. */
export const TimeZoneHelp: Story = {
  render: () => <GeneralCard name="Muster AG" timezone="Europe/Zurich" membershipRole="owner" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/daily digest/)).toBeNull()
    await userEvent.hover(canvas.getByRole('button', { name: 'About Time zone' }))
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() =>
      expect(body.getByRole('tooltip')).toHaveTextContent(
        'Used for today’s date, due dates, engagement periods and the daily digest. Issued invoices keep their dates.',
      ),
    )
  },
}

/** A member still reads why the field is locked under it; the explanation stays behind the (?). */
export const TimeZoneHelpMember: Story = {
  render: () => <GeneralCard name="Muster AG" timezone="Europe/Zurich" membershipRole="member" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Only an owner or admin can change the time zone.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'About Time zone' })).toBeVisible()
  },
}

const unregistered = sampleSettings({
  vat_registered: false,
  default_vat_mode: 'none',
  seller: { ...sampleSettings().seller, vat_number: null },
})

/** VAT off says what that means and what turning it on needs; Save stays a readable disabled chip. */
export const VatOff: Story = {
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get('/api/v1/session', () => HttpResponse.json(session)),
        http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: unregistered })),
      ],
    },
  },
  render: () => (
    <SidebarProvider>
      <CompanySettingsPage />
    </SidebarProvider>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const vat = within(await page.findByRole('region', { name: 'VAT' }))
    const note = vat.getByRole('note', { name: 'Not registered for VAT' })
    await expect(note).toHaveTextContent('Invoices carry no VAT')
    await expect(note).toHaveTextContent('Your UID with MWST')
    await expect(vat.queryByRole('button', { name: 'Save' })).toBeNull()
    await userEvent.click(vat.getByRole('switch', { name: 'Registered for VAT' }))
    await expect(vat.queryByRole('note')).toBeNull()
    await expect(vat.getByLabelText(/^VAT number/)).toBeVisible()
    await expect(vat.getByRole('button', { name: 'Save' })).toBeEnabled()
    await userEvent.click(vat.getByRole('switch', { name: 'Registered for VAT' }))
    await expect(vat.getByRole('note', { name: 'Not registered for VAT' })).toBeVisible()
    await expect(vat.queryByRole('button', { name: 'Save' })).toBeNull()
  },
}

export const VatOffDark: Story = {
  ...VatOff,
  parameters: { ...VatOff.parameters, dark: true },
}

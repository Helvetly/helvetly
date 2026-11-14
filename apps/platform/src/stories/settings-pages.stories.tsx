import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AccountSettings } from '@/components/account/account-settings'
import { InvoiceSettingsPage } from '@/components/settings/invoice-settings'
import { WorkspaceSettings } from '@/components/settings/workspace-settings'
import { accountHandlers as accountMock, resetAccountMock } from '@/mocks/account'
import { notificationHandlers } from '@/mocks/notifications'
import { sampleSettings } from '@/test/invoice-api'

import { screenHandlers, storySession } from './screen-fixtures'

const usage = (granted: boolean) =>
  http.get('/api/v1/heidi/usage', () =>
    HttpResponse.json({
      period: '2026-11',
      tokens_used: 0,
      tokens_included: 0,
      tokens_purchased: 0,
      tokens_remaining: 0,
      provider_available: true,
      consent: granted
        ? { granted: true, changed_at: '2026-11-10T09:00:00Z', changed_by: 'Piotr K.' }
        : { granted: false, changed_at: null, changed_by: '' },
    }),
  )

const accountHandlers = [
  http.get('/api/v1/account', () =>
    HttpResponse.json({
      data: {
        identities: [
          { provider: 'email', email: storySession.user.email, created_at: '2026-11-01T00:00:00Z' },
          {
            provider: 'google',
            email: storySession.user.email,
            created_at: '2026-11-02T00:00:00Z',
          },
        ],
        two_factor: { enabled: true, recovery_codes_left: 8 },
      },
    }),
  ),
  http.get('/api/v1/account/sessions', () =>
    HttpResponse.json({
      data: [
        {
          id: 'ses_1',
          current: true,
          browser: 'Chrome',
          os: 'macOS',
          device: 'desktop',
          ip: '192.0.2.4',
          location: 'Zurich, CH',
          created_at: '2026-11-01T08:00:00Z',
          last_active_at: new Date().toISOString(),
          workspace_name: 'Muster AG',
        },
        {
          id: 'ses_2',
          current: false,
          browser: 'Safari',
          os: 'iOS',
          device: 'mobile',
          ip: '192.0.2.9',
          location: 'Bern, CH',
          created_at: '2026-10-20T08:00:00Z',
          last_active_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          workspace_name: 'Muster AG',
        },
      ],
    }),
  ),
  http.get('/api/v1/account/tokens', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/account/passkeys', () =>
    HttpResponse.json({
      data: [
        {
          id: 'pk_1',
          name: 'MacBook Pro',
          created_at: '2026-10-02T00:00:00Z',
          last_used_at: '2026-11-09T00:00:00Z',
        },
      ],
    }),
  ),
  http.get('/api/v1/auth/config', () =>
    HttpResponse.json({ google: true, email: true, passkey: true, dev_codes: false }),
  ),
]

const meta = {
  title: 'Settings/Pages',
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="flex min-w-0 flex-1 flex-col bg-card">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: { layout: 'fullscreen', ownMain: true },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Sections are bands divided by a hairline, not boxed cards; titles are never shouted. */
const sectionsAreBands = async (canvasElement: HTMLElement) => {
  const sections = [
    ...canvasElement.querySelectorAll<HTMLElement>('[data-slot="settings-section"]'),
  ]
  await expect(sections.length).toBeGreaterThan(1)
  await Promise.all(
    sections.map(async (section, index) => {
      const style = getComputedStyle(section)
      await expect(style.boxShadow).toBe('none')
      await expect(style.borderTopWidth).toBe(index === 0 ? '0px' : '1px')
      await expect(style.borderLeftWidth).toBe('0px')
      const title = section.querySelector('h2')
      await expect(title && getComputedStyle(title).textTransform).toBe('none')
      // Every section title has its small icon before it.
      await expect(title?.firstElementChild).toHaveAttribute('data-slot', 'settings-section-icon')
    }),
  )
}

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1)

/** The settings form grid (settings.css): one grid, so fields share edges and widths by token. */
const formGridAligned = async (canvasElement: HTMLElement) => {
  const company = within(await within(canvasElement).findByRole('region', { name: 'Company' }))
  const box = (name: string) => {
    const field = company
      .getByRole('textbox', { name: new RegExp(`^${name}`) })
      .closest('[data-slot="form-field"]')
    if (!(field instanceof HTMLElement)) throw new Error(`No field for ${name}`)
    return field.getBoundingClientRect()
  }
  const name = box('Company name')
  const street = box('Street')
  const number = box('Number')
  const apt = box('Apt')
  const zip = box('ZIP')
  const city = box('City')
  const email = box('Email')
  // Left and right edges line up row after row.
  for (const row of [street, zip, email]) near(row.left, name.left)
  near(apt.right, name.right)
  // Each width token is one size wherever it is used: md, xs.
  near(email.width, street.width)
  for (const xs of [number, apt, zip, city]) near(xs.width, zip.width)
  await expect(street.width).toBeGreaterThan(zip.width * 1.8)
  // Number format is a select with the next numbers beside it, not a wall of cards.
  const numbering = within(
    canvasElement.querySelector<HTMLElement>('#section-numbering') ?? canvasElement,
  )
  await expect(numbering.queryAllByRole('radio')).toHaveLength(0)
  await expect(numbering.getByRole('status', { name: 'Next numbers' })).toHaveTextContent(
    /Invoice.*Credit note/,
  )
}

/** The page title and subtitle end in one hairline across the panel's whole inner width. */
const headerRuled = async (canvasElement: HTMLElement) => {
  const page = canvasElement.querySelector<HTMLElement>('[data-slot="settings-page"]')
  const header = canvasElement.querySelector<HTMLElement>('[data-slot="settings-page-header"]')
  if (!page || !header) throw new Error('No settings page header')
  await expect(getComputedStyle(header).borderBottomWidth).toBe('1px')
  const style = getComputedStyle(page)
  const inner =
    page.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
  near(header.getBoundingClientRect().width, inner)
}

/** A danger zone is a calm red-edged box with red outline buttons, never a solid red block. */
const dangerZoneBoxed = async (canvasElement: HTMLElement, action: string) => {
  const zone = within(await within(canvasElement).findByRole('region', { name: 'Danger zone' }))
  const box = canvasElement.querySelector<HTMLElement>('[data-slot="danger-zone"]')
  if (!box) throw new Error('No danger zone box')
  await expect(getComputedStyle(box).borderTopWidth).toBe('1px')
  await expect(getComputedStyle(box).borderTopLeftRadius).not.toBe('0px')
  await expect(zone.getByRole('button', { name: action })).toHaveAttribute(
    'data-variant',
    'destructive-outline',
  )
}

/** The settings tabs in the top bar, with this page's tab marked. */
const tabMarked = async (canvasElement: HTMLElement, name: string) => {
  const tabs = within(await within(canvasElement).findByRole('navigation', { name: 'Views' }))
  await expect(tabs.getByRole('button', { name })).toHaveAttribute('aria-current', 'page')
}

export const Workspace: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/settings/workspace' } },
    msw: { handlers: [usage(true), ...screenHandlers] },
  },
  render: () => <WorkspaceSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const ai = await canvas.findByRole('region', { name: 'AI answers with OpenAI' })
    await expect(
      within(ai).getByRole('switch', { name: 'Allow Heidi to use OpenAI' }),
    ).toBeChecked()
    await expect(within(ai).getByText('On since 10 Nov 2026 · by Piotr K.')).toBeVisible()
    await userEvent.click(within(ai).getByRole('button', { name: 'What Heidi shares with OpenAI' }))
    const shares = await within(document.body).findByRole('dialog', {
      name: 'What Heidi shares with OpenAI',
    })
    // The dialog fades in.
    await waitFor(() =>
      expect(within(shares).getByText('Processed by OpenAI in the USA')).toBeVisible(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(shares).not.toBeInTheDocument())
    await expect(canvas.getByRole('region', { name: 'Danger zone' })).toBeVisible()
    await sectionsAreBands(canvasElement)
    await headerRuled(canvasElement)
    await dangerZoneBoxed(canvasElement, 'Delete workspace')
  },
}

export const WorkspaceAIOff: Story = {
  ...Workspace,
  parameters: { ...Workspace.parameters, msw: { handlers: [usage(false), ...screenHandlers] } },
  play: async ({ canvasElement }) => {
    const ai = within(
      await within(canvasElement).findByRole('region', { name: 'AI answers with OpenAI' }),
    )
    await expect(ai.getByRole('switch', { name: 'Allow Heidi to use OpenAI' })).not.toBeChecked()
    await expect(ai.getByText('Off: Heidi answers from your data only')).toBeVisible()
  },
}

export const Account: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/account' } },
    msw: { handlers: [...accountHandlers, ...notificationHandlers, ...screenHandlers] },
  },
  render: () => <AccountSettings />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('MacBook Pro')
    await tabMarked(canvasElement, 'Account')
    await sectionsAreBands(canvasElement)
    await headerRuled(canvasElement)
    await dangerZoneBoxed(canvasElement, 'Delete account')
    // Signing out everywhere else is a red outline button under the list, and asks first.
    const sessions = within(canvas.getByRole('region', { name: 'Active sessions' }))
    const all = sessions.getByRole('button', { name: 'Sign out of all other sessions' })
    await expect(all).toHaveAttribute('data-variant', 'destructive-outline')
    await expect(all.closest('[data-slot="sessions-footer"]')).not.toBeNull()
    await userEvent.click(all)
    const confirm = await within(document.body).findByRole('dialog', {
      name: 'Sign out of all other sessions?',
    })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(confirm).not.toBeInTheDocument())
  },
}

/** No passkeys: "Add passkey" is the empty state's one primary action, not a second button. */
export const AccountNoPasskeys: Story = {
  ...Account,
  parameters: {
    ...Account.parameters,
    msw: {
      handlers: [
        http.get('/api/v1/account/passkeys', () => HttpResponse.json({ data: [] })),
        ...accountHandlers,
        ...notificationHandlers,
        ...screenHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const section = within(await within(canvasElement).findByRole('region', { name: 'Passkeys' }))
    const empty = await section.findByText('No passkeys yet')
    const add = section.getAllByRole('button', { name: 'Add passkey' })
    await expect(add).toHaveLength(1)
    const slot = empty.closest('[data-slot="settings-empty"]')
    await expect(slot?.contains(add[0] ?? null)).toBe(true)
    await expect(add[0]).toHaveAttribute('data-variant', 'default')
  },
}

const passkey = (id: string, name: string) => ({
  id,
  name,
  created_at: '2026-10-02T00:00:00Z',
  last_used_at: null,
})

/** Passkeys listed: "Add passkey" sits once, under the list at its right end, not beside the title. */
export const AccountPasskeys: Story = {
  ...Account,
  parameters: {
    ...Account.parameters,
    msw: {
      handlers: [
        http.get('/api/v1/account/passkeys', () =>
          HttpResponse.json({
            data: [passkey('pk_1', 'MacBook Pro'), passkey('pk_2', 'iPhone 17')],
          }),
        ),
        ...accountHandlers,
        ...notificationHandlers,
        ...screenHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const region = await within(canvasElement).findByRole('region', { name: 'Passkeys' })
    const section = within(region)
    const list = await section.findByRole('list')
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    const add = section.getAllByRole('button', { name: 'Add passkey' })
    await expect(add).toHaveLength(1)
    const button = add[0]
    if (!button) throw new Error('no Add passkey')
    await expect(region.querySelector('header')?.contains(button)).toBe(false)
    await expect(
      list.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const listBox = list.getBoundingClientRect()
    const buttonBox = button.getBoundingClientRect()
    await expect(buttonBox.top).toBeGreaterThanOrEqual(listBox.bottom)
    await expect(Math.abs(buttonBox.right - listBox.right)).toBeLessThan(2)
  },
}

/** Turning on 2FA: the QR code is the main step; the key (with copy) and the app link are the fallbacks. */
export const AccountTwoFactorSetup: Story = {
  ...Account,
  parameters: {
    ...Account.parameters,
    // The account mock: two-factor off, and a setup answer with a real otpauth URL.
    msw: {
      handlers: [...accountMock, ...accountHandlers, ...notificationHandlers, ...screenHandlers],
    },
  },
  beforeEach: resetAccountMock,
  play: async ({ canvasElement }) => {
    const region = await within(canvasElement).findByRole('region', {
      name: 'Two-factor authentication',
    })
    await userEvent.click(await within(region).findByRole('button', { name: 'Turn on' }))
    const dialog = within(
      await within(document.body).findByRole('dialog', {
        name: 'Turn on two-factor authentication',
      }),
    )
    const qr = await dialog.findByTestId('totp-qr')
    await expect(qr.tagName.toLowerCase()).toBe('svg')
    await expect(qr.querySelector('title')).toHaveTextContent('QR code for your authenticator app')
    await expect(qr.querySelectorAll('path').length).toBeGreaterThan(0)
    await expect(qr.getBoundingClientRect().width).toBeGreaterThan(150)
    const key = dialog.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    // The dialog fades in.
    await waitFor(() => expect(key).toBeVisible())
    // The QR comes first; the fallbacks follow it.
    await expect(qr.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await expect(dialog.getByRole('button', { name: 'Copy key' })).toBeVisible()
    await expect(
      dialog.getByRole('link', { name: 'Open in an authenticator app on this device' }),
    ).toHaveAttribute(
      'href',
      expect.stringMatching(/^otpauth:\/\/totp\/Helvetly:.+issuer=Helvetly/),
    )
  },
}

export const AccountTwoFactorSetupDark: Story = {
  ...AccountTwoFactorSetup,
  parameters: { ...AccountTwoFactorSetup.parameters, dark: true },
}

export const Invoices: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/settings/invoices' } },
    msw: {
      handlers: [
        http.get('/api/v1/invoice-settings', () =>
          HttpResponse.json({ data: sampleSettings({ iban: null }) }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => <InvoiceSettingsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('region', { name: 'Company' })
    await tabMarked(canvasElement, 'Invoices')
    await sectionsAreBands(canvasElement)
    await formGridAligned(canvasElement)
    await headerRuled(canvasElement)
    // The readiness notice ends where the form grid ends, not at the panel's edge.
    const notice = canvasElement.querySelector<HTMLElement>('[data-slot="settings-notice"]')
    const name = canvas
      .getByRole('textbox', { name: /^Company name/ })
      .closest('[data-slot="form-field"]')
    if (!notice || !name) throw new Error('No readiness notice or company name')
    near(notice.getBoundingClientRect().right, name.getBoundingClientRect().right)
  },
}

/**
 * The page's notes: VAT's "while it is off" note and the dunning timeline span the whole card, the IBAN's kind reads as a
 * title (not a button) and the revolut.me link is tried from an icon button at the end of its input.
 */
export const InvoicesNotes: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/settings/invoices' } },
    msw: {
      handlers: [
        http.get('/api/v1/invoice-settings', () =>
          HttpResponse.json({
            data: sampleSettings({
              vat_registered: false,
              default_vat_mode: 'none',
              revolut_enabled: true,
              revolut_username: 'anna-muster',
            }),
          }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => <InvoiceSettingsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const vat = await canvas.findByRole('region', { name: 'VAT' })
    const note = within(vat).getByRole('note', { name: 'Not registered for VAT' })
    const row = within(vat).getByText('Registered for VAT').closest('[data-slot="switch-row"]')
    await expect(row).not.toBeNull()
    await expect(note.getBoundingClientRect().left).toBe(row?.getBoundingClientRect().left)
    await expect(note.getBoundingClientRect().width).toBe(row?.getBoundingClientRect().width)

    const dunning = canvas.getByRole('region', { name: 'Dunning' })
    const reminders = within(dunning).getByRole('list', { name: 'Reminders' })
    const dunningRow = within(dunning)
      .getByText('Send reminders automatically')
      .closest('[data-slot="switch-row"]')
    await expect(reminders.getBoundingClientRect().left).toBe(
      dunningRow?.getBoundingClientRect().left,
    )

    const bank = canvas.getByRole('region', { name: 'Bank account' })
    await expect(within(bank).getByText('Swiss IBAN')).toBeVisible()
    await expect(within(bank).queryByRole('button', { name: /IBAN/ })).toBeNull()

    const payment = canvas.getByRole('region', { name: 'Payment methods' })
    const test = within(payment).getByRole('link', { name: 'Test the link' })
    await expect(test).toHaveAttribute('href', 'https://revolut.me/anna-muster')
    await expect(test).toHaveAttribute('target', '_blank')
    await expect(within(payment).queryByText(/^Test revolut\.me/)).toBeNull()
    await userEvent.hover(test)
    await expect(
      await within(document.body).findByRole('tooltip', { name: /revolut\.me\/anna-muster/ }),
    ).toBeInTheDocument()
  },
}

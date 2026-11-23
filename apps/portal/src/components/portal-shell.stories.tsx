import { ThemeProvider } from '@helvetly/ui/components/theme-provider'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalDocuments, portalHandlers, portalSession } from '@/mocks/portal'
import { schedulingHandlers } from '@/mocks/scheduling'

import { PortalDocuments } from './portal-documents'
import { PortalEngagements } from './portal-engagements'
import { PortalInvoices } from './portal-invoices'
import { PortalOverview } from './portal-overview'
import { PortalProfile } from './portal-profile'
import { PortalShell } from './portal-shell'

const P = '/api/v1/public/portal'
const longClient = 'Muster Beratung und Treuhand AG with a fairly long name'
const longDocument = 'Mandate agreement 2026 signed version final-370d2faa.pdf'
const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}

// Long names from real data: nothing may push the page sideways.
const meta = {
  title: 'Portal/Shell',
  parameters: {
    ownMain: true,
    ...phone,
    msw: {
      handlers: [
        http.get(`${P}/session`, () =>
          HttpResponse.json({
            ...portalSession,
            client: { id: 'cli_1', name: longClient },
            clients: [
              { id: 'cli_1', name: longClient, workspace_name: 'Muster GmbH' },
              { id: 'cli_2', name: 'Keller AG', workspace_name: 'Beispiel Treuhand AG' },
            ],
          }),
        ),
        http.get(`${P}/documents`, () =>
          HttpResponse.json({
            data: [{ ...portalDocuments[0], name: longDocument }, ...portalDocuments.slice(1)],
          }),
        ),
        ...portalHandlers,
      ],
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const page = (children: ReactNode) => () => <PortalShell>{children}</PortalShell>

const longWorkspace = 'John Doe Consulting und Treuhand GmbH with a long registered name'
const shortWorkspace = 'John Doe Consult…'
const longEmail = 'anna.mueller-bernasconi.accounting@muster-beratung-treuhand.ch'

/** Desktop: the client's name by its avatar on one pill that opens the account menu; the email is in the menu. */
export const Desktop: Story = {
  render: page(<PortalOverview />),
  parameters: {
    ...meta.parameters,
    msw: {
      handlers: [
        http.get(`${P}/session`, () =>
          HttpResponse.json({
            ...portalSession,
            email: longEmail,
            workspace: { name: longWorkspace },
            client: { id: 'cli_1', name: longClient },
            clients: [
              { id: 'cli_1', name: longClient, workspace_name: 'Muster GmbH' },
              { id: 'cli_2', name: 'Keller AG', workspace_name: 'Beispiel Treuhand AG' },
            ],
          }),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const account = canvas.getByRole('button', { name: /^Account menu/ })
    // A long name is cut short on the button, whole in its title; no email on the button.
    const name = within(account).getByText(longClient)
    await expect(name).toBeVisible()
    await expect(name).toHaveAttribute('title', longClient)
    await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    await expect(account).not.toHaveTextContent(longEmail)
    await expect(account.getBoundingClientRect().width).toBeLessThanOrEqual(240)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    const atRest = getComputedStyle(account).boxShadow

    await userEvent.click(account)
    const menu = await within(document.body).findByRole('menu')
    await waitFor(() => expect(within(menu).getByText('Switch client')).toBeVisible())
    await expect(within(menu).getByText(longEmail)).toBeVisible()
    await expect(within(menu).getByRole('menuitemradio', { name: /Keller AG/ })).toHaveTextContent(
      'Beispiel Treuhand AG',
    )
    await expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toBeVisible()
    await expect(within(menu).getByRole('menuitem', { name: /^Language/ })).toHaveTextContent(
      'English',
    )
    await expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('menu')).toBeNull())
    // Opened with the mouse: focus comes back to the button without the keyboard ring.
    await expect(account).toHaveFocus()
    await expect(getComputedStyle(account).boxShadow).toBe(atRest)
    // The header at rest for the visual baseline.
    account.blur()
  },
}

/**
 * The language row opens the product's language dialog (the one on the sign-in page), every language in it and the
 * current one pressed; the menu is gone by then. Escape closes it and gives focus back to the account button.
 */
export const LanguageDialog: Story = {
  render: page(<PortalOverview />),
  play: async ({ canvasElement }) => {
    const account = await within(canvasElement).findByRole('button', { name: /^Account menu/ })
    account.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await within(document.body).findByRole('menu')
    const language = within(menu).getByRole('menuitem', { name: /^Language/ })
    await expect(language).toHaveTextContent('English')
    await userEvent.click(language)
    const dialog = await within(document.body).findByRole('dialog', { name: 'Change language' })
    await waitFor(() => expect(within(document.body).queryByRole('menu')).toBeNull())
    const options = within(dialog).getAllByRole('button', { pressed: false })
    await expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining(['Deutsch', 'Français', 'Italiano']),
    )
    await expect(within(dialog).getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(account).toHaveFocus())
  },
}
export const LanguageDialogDark: Story = {
  ...LanguageDialog,
  parameters: { ...meta.parameters, dark: true },
}

// Its own storage key, so a story never changes the theme Storybook itself remembers.
const THEME_KEY = 'story-portal-theme'

/** Light / Dark / System in the account menu, as on the platform: a choice applies at once and is saved. */
export const ThemeSwitch: Story = {
  render: page(<PortalOverview />),
  decorators: [
    (Story) => {
      localStorage.removeItem(THEME_KEY)
      return (
        <ThemeProvider storageKey={THEME_KEY} hotkey={false}>
          <Story />
        </ThemeProvider>
      )
    },
  ],
  play: async ({ canvasElement }) => {
    const html = document.documentElement
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: /^Account menu/ }),
    )
    const menu = await within(document.body).findByRole('menu')
    const theme = within(menu).getByRole('group', { name: 'Theme' })
    await waitFor(() =>
      expect(within(theme).getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
    await userEvent.click(within(theme).getByRole('menuitemradio', { name: 'Dark' }))
    await waitFor(() => expect(html).toHaveClass('dark'))
    await expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    // Choosing a theme keeps the menu open, as on the platform.
    await expect(menu).toBeVisible()
    await userEvent.click(within(theme).getByRole('menuitemradio', { name: 'Light' }))
    await waitFor(() => expect(html).not.toHaveClass('dark'))
    await expect(localStorage.getItem(THEME_KEY)).toBe('light')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(menu).not.toBeInTheDocument())
  },
}

export const DesktopDark: Story = { ...Desktop, parameters: { ...Desktop.parameters, dark: true } }

async function fitsThePhone(canvasElement: HTMLElement, text: string) {
  await within(canvasElement).findAllByText(text)
  await expect(window.innerWidth).toBe(390)
  await waitFor(() =>
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
  )
  // The tabs sit in a bar at the bottom of the screen.
  const nav = within(canvasElement).getByRole('navigation', { name: 'Portal' })
  await expect(Math.round(nav.getBoundingClientRect().bottom)).toBe(window.innerHeight)
}

const onPhone = (render: Story['render'], text: string): Story => ({
  render,
  globals: { viewport: { value: 'phone' } },
  play: ({ canvasElement }) => fitsThePhone(canvasElement, text),
})
const dark = (story: Story): Story => ({ ...story, parameters: { ...meta.parameters, dark: true } })

/** On a phone the account button is the avatar alone; its tooltip names the client. */
export const OverviewPhone: Story = {
  ...onPhone(page(<PortalOverview />), longDocument),
  play: async ({ canvasElement }) => {
    await fitsThePhone(canvasElement, longDocument)
    const account = within(canvasElement).getByRole('button', { name: /^Account menu/ })
    await expect(within(account).getByText(longClient)).not.toBeVisible()
    await expect(account.getBoundingClientRect().width).toBe(40)
  },
}
export const OverviewPhoneDark = dark(OverviewPhone)

/** A phone with long supplier and client names: the supplier's name is cut by the width, the avatar stays round. */
export const LongNamesPhone: Story = {
  render: page(<PortalOverview />),
  globals: { viewport: { value: 'phone' } },
  parameters: {
    ...meta.parameters,
    msw: {
      handlers: [
        http.get(`${P}/session`, () =>
          HttpResponse.json({
            ...portalSession,
            workspace: { name: longWorkspace },
            client: { id: 'cli_1', name: longClient },
          }),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await fitsThePhone(canvasElement, 'Needs your attention')
    const name = within(canvasElement).getByLabelText(longWorkspace)
    await expect(name).toHaveTextContent(shortWorkspace)
    const account = within(canvasElement).getByRole('button', { name: /^Account menu/ })
    await expect(account.getBoundingClientRect().width).toBe(40)
    await expect(name.getBoundingClientRect().right).toBeLessThan(
      account.getBoundingClientRect().left,
    )
  },
}
export const LongNamesPhoneDark: Story = {
  ...LongNamesPhone,
  parameters: { ...LongNamesPhone.parameters, dark: true },
}

export const InvoicesPhone: Story = {
  ...onPhone(page(<PortalInvoices />), 'Open the invoice PDF for payment details.'),
  play: async ({ canvasElement }) => {
    await fitsThePhone(canvasElement, 'Open the invoice PDF for payment details.')
    // The number keeps one line next to its amount and PDF icon.
    const number = within(canvasElement).getByText(`${new Date().getFullYear()}-014`)
    await expect(number.getBoundingClientRect().height).toBeLessThan(24)
  },
}
export const InvoicesPhoneDark = dark(InvoicesPhone)

export const EngagementsPhone = onPhone(page(<PortalEngagements />), 'Support retainer')
export const EngagementsPhoneDark = dark(EngagementsPhone)

export const DocumentsPhone = onPhone(page(<PortalDocuments />), longDocument)
export const DocumentsPhoneDark = dark(DocumentsPhone)

export const ProfilePhone = onPhone(page(<PortalProfile />), 'Tax IDs')
export const ProfilePhoneDark = dark(ProfilePhone)

/** Tablet width, long supplier name: shown once, cut by the width beside the tabs, and its tooltip has all of it. */
export const LongWorkspaceName: Story = {
  render: page(<PortalOverview />),
  globals: { viewport: { value: 'tablet' } },
  parameters: {
    ...meta.parameters,
    viewport: {
      options: { tablet: { name: 'Tablet', styles: { width: '820px', height: '900px' } } },
    },
    msw: {
      handlers: [
        http.get(`${P}/session`, () =>
          HttpResponse.json({ ...portalSession, workspace: { name: longWorkspace } }),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Once, cut after 16 characters with an ellipsis; the whole name is its accessible name and tooltip.
    const name = await canvas.findByLabelText(longWorkspace)
    await expect(name).toHaveTextContent(shortWorkspace)
    await expect(
      canvasElement.querySelector('header')?.textContent?.split(shortWorkspace),
    ).toHaveLength(2)
    const nav = canvas.getByRole('navigation', { name: 'Portal' })
    await expect(name.getBoundingClientRect().right).toBeLessThanOrEqual(
      nav.getBoundingClientRect().left,
    )
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    await userEvent.hover(name)
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(longWorkspace)
  },
}
export const LongWorkspaceNameDark: Story = {
  ...LongWorkspaceName,
  parameters: { ...LongWorkspaceName.parameters, dark: true },
}

/**
 * A wide screen: the header spans the whole width, the supplier at the far left and the tabs beside the
 * account menu at the far right. A click on a tab leaves no focus box; the keyboard still gets the ring.
 */
export const WideScreen: Story = {
  render: page(<PortalOverview />),
  globals: { viewport: { value: 'wide' } },
  parameters: {
    ...meta.parameters,
    viewport: { options: { wide: { name: 'Wide', styles: { width: '1920px', height: '900px' } } } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const overview = await canvas.findByRole('link', { name: 'Overview' })
    // The test browser is 1200 px wide: still wider than the page's centred column.
    const row = canvasElement.querySelector('header > div')
    const header = row?.getBoundingClientRect() ?? new DOMRect()
    const brand = row?.firstElementChild?.getBoundingClientRect()
    const avatar = canvas.getByRole('button', { name: /^Account menu/ }).getBoundingClientRect()
    const nav = canvas.getByRole('navigation', { name: 'Portal' }).getBoundingClientRect()
    await expect((brand?.left ?? 0) - header.left).toBeLessThanOrEqual(32)
    await expect(header.right - avatar.right).toBeLessThanOrEqual(32)
    await expect(avatar.left - nav.right).toBeLessThan(40)

    await userEvent.click(overview)
    await expect(overview).not.toHaveFocus()
    await expect(getComputedStyle(overview).boxShadow).not.toMatch(/inset/)
    overview.focus()
    await userEvent.tab()
    const invoices = canvas.getByRole('link', { name: 'Invoices' })
    await expect(invoices).toHaveFocus()
    await expect(getComputedStyle(invoices).boxShadow).toMatch(/inset/)
  },
}
export const WideScreenDark = dark(WideScreen)

/**
 * The header is a bar of its own: the card surface and a hairline at the top of the page, and a soft shadow once
 * the page passes under it.
 */
export const ScrolledHeader: Story = {
  render: page(<PortalOverview />),
  parameters: Desktop.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Needs your attention')
    // Every section loaded, so the page has its full height before it scrolls.
    await canvas.findByText('Engagement usage')
    await within(await canvas.findByRole('region', { name: 'Recently shared' })).findAllByRole(
      'listitem',
    )
    const header = canvasElement.querySelector('header')
    await expect(header).not.toHaveAttribute('data-scrolled')
    const style = getComputedStyle(header ?? document.body)
    await expect(style.backgroundColor).not.toBe(getComputedStyle(document.body).backgroundColor)
    await expect(style.borderBottomWidth).toBe('1px')
    // Well short of the end of the page, so every renderer stops at the same place.
    window.scrollTo(0, 120)
    await waitFor(() => expect(header).toHaveAttribute('data-scrolled'))
    await expect(getComputedStyle(header ?? document.body).boxShadow).not.toBe('none')
    // The content goes under the header, which stays at the top.
    await expect(header?.getBoundingClientRect().top).toBe(0)
  },
}
export const ScrolledHeaderDark: Story = {
  ...ScrolledHeader,
  parameters: { ...Desktop.parameters, dark: true },
}

/** A workspace with Scheduling: the Sessions tab joins the bar, five across on a phone without pushing sideways. */
export const WithSessions: Story = {
  render: page(<PortalOverview />),
  parameters: {
    msw: { handlers: [...schedulingHandlers, ...meta.parameters.msw.handlers] },
  },
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    const nav = await within(canvasElement).findByRole('navigation', { name: 'Portal' })
    const tab = await within(nav).findByRole('link', { name: 'Sessions' })
    await expect(tab).toHaveAttribute('href', '/sessions/')
    await expect(within(nav).getAllByRole('link')).toHaveLength(5)
    await expect(
      await within(canvasElement).findByRole('region', { name: 'Next session' }),
    ).toBeVisible()
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

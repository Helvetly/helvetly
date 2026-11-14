import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalDocuments, portalHandlers, portalSession } from '@/mocks/portal'

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

/** Desktop: pill tabs, the client's name by its avatar, and the account menu with the switcher. */
export const Desktop: Story = {
  render: page(<PortalOverview />),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await userEvent.click(canvas.getByRole('button', { name: /^Account menu/ }))
    const menu = await within(document.body).findByRole('menu')
    await waitFor(() => expect(within(menu).getByText(portalSession.email)).toBeVisible())
    await expect(within(menu).getByText('Switch client')).toBeVisible()
    await expect(within(menu).getByRole('menuitemradio', { name: /Keller AG/ })).toHaveTextContent(
      'Beispiel Treuhand AG',
    )
    await expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toBeVisible()
    await expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('menu')).toBeNull())
  },
}

export const DesktopDark: Story = { ...Desktop, parameters: { ...meta.parameters, dark: true } }

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

export const OverviewPhone = onPhone(page(<PortalOverview />), longDocument)
export const OverviewPhoneDark = dark(OverviewPhone)

export const InvoicesPhone: Story = {
  ...onPhone(page(<PortalInvoices />), 'Pay with the Swiss QR bill in each PDF.'),
  play: async ({ canvasElement }) => {
    await fitsThePhone(canvasElement, 'Pay with the Swiss QR bill in each PDF.')
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

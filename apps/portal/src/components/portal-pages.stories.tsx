import { setCsrfToken } from '@helvetly/ui/lib/http'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ReactNode } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { portalHandlers, portalSession } from '@/mocks/portal'

import { PortalDocuments } from './portal-documents'
import { PortalEngagements } from './portal-engagements'
import { PortalInvoices } from './portal-invoices'
import { PortalOverview } from './portal-overview'
import { PortalProfile } from './portal-profile'
import { PortalQuotes } from './portal-quotes'
import { PortalShell } from './portal-shell'

// The portal's screens in its real shell, in light, dark and on a 390px phone, for visual review
// and `scripts/screens.mjs` (the platform's are under "Pages/…" in its own Storybook).
const meta = {
  title: 'Pages/Portal',
  beforeEach: () => setCsrfToken(portalSession.csrf_token),
  parameters: {
    layout: 'fullscreen',
    ownMain: true,
    bare: true,
    msw: { handlers: portalHandlers },
    viewport: {
      options: {
        desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } },
        phone: { name: 'Phone', styles: { width: '390px', height: '844px' } },
      },
    },
  },
  globals: { viewport: { value: 'desktop' } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const screen = (pathname: string, page: ReactNode, ...texts: string[]): Story => ({
  parameters: { nextjs: { navigation: { pathname } } },
  render: () => <PortalShell>{page}</PortalShell>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(
      () => {
        for (const text of texts)
          expect(canvas.getAllByText(text).some((node) => node.checkVisibility())).toBe(true)
      },
      { timeout: 8000 },
    )
  },
})
const dark = (story: Story): Story => ({
  ...story,
  parameters: { ...story.parameters, dark: true },
})
const phone = (story: Story): Story => ({ ...story, globals: { viewport: { value: 'phone' } } })

export const Overview = screen('/', <PortalOverview />, 'Contract.pdf')
export const OverviewDark = dark(Overview)
export const OverviewPhone = phone(Overview)

export const Invoices = screen('/invoices', <PortalInvoices />, `${new Date().getFullYear()}-014`)
export const InvoicesDark = dark(Invoices)
export const InvoicesPhone = phone(Invoices)

export const Quotes = screen('/quotes', <PortalQuotes />, `Q-${new Date().getFullYear()}-001`)
export const QuotesDark = dark(Quotes)
export const QuotesPhone = phone(Quotes)

export const Engagements = screen('/engagements', <PortalEngagements />, 'Support retainer')
export const EngagementsDark = dark(Engagements)
export const EngagementsPhone = phone(Engagements)

export const Documents = screen('/documents', <PortalDocuments />, 'Contract.pdf')
export const DocumentsDark = dark(Documents)
export const DocumentsPhone = phone(Documents)

export const Profile = screen('/profile', <PortalProfile />, 'Billing email')
export const ProfileDark = dark(Profile)
export const ProfilePhone = phone(Profile)

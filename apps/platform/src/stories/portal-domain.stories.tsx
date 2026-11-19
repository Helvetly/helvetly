import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { PortalDomainSection } from '@/components/settings/portal-domain'
import type { PlanId } from '@/lib/billing'
import {
  portalDomain,
  portalDomainHandlers,
  portalDomainLockedHandlers,
  resetPortalDomain,
} from '@/mocks/portal-domain'

const onPlan = (plan: PlanId) =>
  http.get('/api/v1/billing', () =>
    HttpResponse.json({ data: billingFixture({ locked: false, plan, status: 'active' }) }),
  )

const meta = {
  title: 'Settings/Portal domain',
  component: PortalDomainSection,
  args: { canEdit: true },
  parameters: { msw: { handlers: [onPlan('business'), ...portalDomainHandlers] } },
  beforeEach: () => resetPortalDomain(),
  render: (args) => (
    <div className="@container/sections max-w-5xl p-6">
      <PortalDomainSection {...args} />
      <Toaster />
    </div>
  ),
} satisfies Meta<typeof PortalDomainSection>
export default meta
type Story = StoryObj<typeof meta>

const page = () => within(document.body)

/** No domain yet: a pasted address becomes the bare host, and the DNS records to add appear. */
export const AddDomain: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByLabelText(/^Domain/)
    await userEvent.type(input, 'https://Portal.Firma.ch/login')
    await userEvent.click(canvas.getByRole('button', { name: 'Add domain' }))
    await expect(
      await canvas.findByText('portal.firma.ch', { selector: '.text-body' }),
    ).toBeVisible()
    await expect(canvas.getByText('Waiting for DNS')).toBeVisible()
    await expect(canvas.getByText('domains.helvetly.com')).toBeVisible()
    await expect(canvas.getByText('_helvetly-verify.portal.firma.ch')).toBeVisible()
    await expect(
      await page().findByText('Domain added. Now add the two DNS records.'),
    ).toBeInTheDocument()
  },
}

/** Waiting for DNS: the CNAME and the TXT record, each explained and copied with one click, and the release date. */
export const WaitingForDns: Story = {
  beforeEach: () => resetPortalDomain(portalDomain()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Waiting for DNS')).toBeVisible()
    await expect(canvas.getByText('CNAME')).toBeVisible()
    await expect(canvas.getByText('TXT')).toBeVisible()
    await expect(canvas.getByText('Points your domain at Helvetly.')).toBeVisible()
    await expect(canvas.getByText(/Proves the domain is yours/)).toBeVisible()
    await expect(
      canvas.getByText(/Finish the setup by .*, or the domain is released\./),
    ).toBeVisible()
    const write = fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    })
    const copy = canvas.getByRole('button', { name: 'Copy value: domains.helvetly.com' })
    await userEvent.hover(copy)
    await expect(await page().findByRole('tooltip')).toHaveTextContent('Copy value')
    await userEvent.click(copy)
    await expect(write).toHaveBeenCalledWith('domains.helvetly.com')
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Copy value: helvetly-3f9a1c7e5b2d48a6c0e1f7a9b3d5c2e8',
      }),
    )
    await expect(write).toHaveBeenCalledWith('helvetly-3f9a1c7e5b2d48a6c0e1f7a9b3d5c2e8')
    await expect(await page().findByText('Copied')).toBeInTheDocument()
  },
}

/** The CNAME is there, the TXT record that proves ownership is not. */
export const VerificationMissing: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'dns', 'verification')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveTextContent(
      'The TXT record that proves this domain is yours is missing.',
    )
    await expect(alert).toHaveTextContent(
      'No TXT record _helvetly-verify.portal.mueller-treuhand.ch',
    )
    await expect(canvas.getByText('Waiting for DNS')).toBeVisible()
  },
}

/** DNS and ownership are right; the domain does not answer over HTTPS yet. */
export const Certificate: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'certificate')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Issuing certificate')).toBeVisible()
    await expect(canvas.getByRole('alert')).toHaveTextContent('does not answer over HTTPS yet')
  },
}

/** Re-check moves it on: the certificate is being issued. */
export const IssuingCertificate: Story = {
  beforeEach: () => resetPortalDomain(portalDomain()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Re-check' }))
    await expect(await canvas.findByText('Issuing certificate')).toBeVisible()
  },
}

/** Active: the domain opens the portal, and removing it asks first. */
export const Active: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'active')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('link', { name: 'portal.mueller-treuhand.ch' }),
    ).toHaveAttribute('href', 'https://portal.mueller-treuhand.ch/')
    await expect(canvas.getByText('Active')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove' }))
    const dialog = await page().findByRole('dialog')
    await expect(dialog).toHaveTextContent('Remove portal.mueller-treuhand.ch?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove domain' }))
    await expect(await canvas.findByLabelText(/^Domain/)).toBeVisible()
    await expect(await page().findByText('Custom domain removed')).toBeInTheDocument()
  },
}

/** A domain that broke (the CNAME is gone) says why. */
export const Problem: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'problem')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Problem')).toBeVisible()
    const alert = canvas.getByRole('alert')
    await expect(alert).toHaveTextContent('The DNS record is missing or points elsewhere.')
    await expect(alert).toHaveTextContent(
      'No CNAME record from portal.mueller-treuhand.ch to domains.helvetly.com',
    )
  },
}

/** After a downgrade the domain is off until an upgrade, and says when it is released. */
export const PlanLost: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'problem', 'plan')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveTextContent(/no longer includes your own domain.*released on/)
    await expect(canvas.queryByText(/Finish the setup by/)).toBeNull()
  },
}

/** A member sees the status and the records, no buttons. */
export const ReadOnly: Story = {
  args: { canEdit: false },
  beforeEach: () => resetPortalDomain(portalDomain()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Waiting for DNS')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Re-check' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Remove' })).toBeNull()
  },
}

/** A member of a workspace without one is told an owner or admin adds it. */
export const ReadOnlyNone: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('No custom domain yet. An owner or admin can add one.'),
    ).toBeVisible()
  },
}

/** A plan without custom domains: the plan that has them, nothing to type. */
export const PlanLocked: Story = {
  parameters: { msw: { handlers: [onPlan('pro'), ...portalDomainLockedHandlers] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(/include a custom portal domain; Business does/),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Add domain' })).toBeDisabled()
    await expect(canvas.queryByLabelText(/^Domain/)).toBeNull()
  },
}

/** The API's refusals show at the field: a main domain, another workspace's domain. */
export const Refused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByLabelText(/^Domain/)
    await userEvent.type(input, 'firma.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Add domain' }))
    await expect(await canvas.findByText(/Use a subdomain such as/)).toBeVisible()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await userEvent.clear(input)
    await userEvent.type(input, 'portal.acme.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Add domain' }))
    await expect(await canvas.findByText('Another workspace uses this domain.')).toBeVisible()
    await userEvent.clear(input)
    await userEvent.type(input, 'portal.down.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Add domain' }))
    await expect(await canvas.findByText(/DNS did not answer/)).toBeVisible()
  },
}

/** Another workspace added the domain without proving it: the TXT record that would prove it is ours to add. */
export const TakenUnproven: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByLabelText(/^Domain/)
    await userEvent.type(input, 'portal.claimed.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Add domain' }))
    await expect(await canvas.findByText(/without proving it owns it/)).toBeVisible()
    await expect(canvas.getByText('_helvetly-verify.portal.claimed.ch')).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Copy value: helvetly-0a1b2c3d4e5f60718293a4b5c6d7e8f9' }),
    ).toBeVisible()
  },
}

/** Without CUSTOM_DOMAIN_TARGET on the server the section is not there. */
export const Disabled: Story = {
  beforeEach: () => resetPortalDomain(null, false),
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect(within(canvasElement).queryByText('Custom domain')).toBeNull()
  },
}

export const Dark: Story = { ...WaitingForDns, parameters: { ...meta.parameters, dark: true } }

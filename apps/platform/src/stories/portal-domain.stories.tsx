import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { PortalDomainRow } from '@/components/settings/portal-domain'
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
  component: PortalDomainRow,
  args: { canEdit: true, currentUrl: 'https://portal.helvetly.com/w/mueller-treuhand/' },
  parameters: { msw: { handlers: [onPlan('business'), ...portalDomainHandlers] } },
  beforeEach: () => resetPortalDomain(),
  render: (args) => (
    <div className="@container/sections max-w-5xl p-6">
      <PortalDomainRow {...args} />
      <Toaster />
    </div>
  ),
} satisfies Meta<typeof PortalDomainRow>
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
    await expect(canvas.getByText('portal.helvetly.com')).toBeVisible()
    await expect(canvas.getByText('_cf-custom-hostname.portal.firma.ch')).toBeVisible()
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
    await expect(canvas.getByText('Points your domain at your client portal.')).toBeVisible()
    await expect(canvas.getByText(/Proves the domain is yours/)).toBeVisible()
    const alert = canvas.getByRole('alert')
    await expect(alert).toHaveAttribute('data-tone', 'warning')
    await expect(alert).toHaveTextContent('Waiting for your DNS records')
    await expect(alert).toHaveTextContent(/Finish the setup by .*, or the domain is released\./)
    const write = fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    })
    const copy = canvas.getByRole('button', { name: 'Copy value: portal.helvetly.com' })
    await userEvent.hover(copy)
    await expect(await page().findByRole('tooltip')).toHaveTextContent('Copy value')
    await userEvent.click(copy)
    await expect(write).toHaveBeenCalledWith('portal.helvetly.com')
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Copy value: 5cc0f6b2-8f5c-4c1e-9d0a-3e7b2a91c4d8',
      }),
    )
    await expect(write).toHaveBeenCalledWith('5cc0f6b2-8f5c-4c1e-9d0a-3e7b2a91c4d8')
    await expect(await page().findByText('Copied')).toBeInTheDocument()
  },
}

/** Cloudflare sees the CNAME, but the TXT record that proves ownership is not there: a CNAME alone proves nothing. */
export const VerificationMissing: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'dns', 'verification')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveAttribute('data-tone', 'warning')
    await expect(alert).toHaveTextContent('Ownership record not found yet')
    await expect(alert).toHaveTextContent(
      'The TXT record that proves this domain is yours is missing.',
    )
    await expect(canvas.getByText('Waiting for DNS')).toBeVisible()
  },
}

/** DNS and ownership are right; Cloudflare is issuing the certificate. */
export const Certificate: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'certificate')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Issuing certificate')).toBeVisible()
    const alert = canvas.getByRole('alert')
    await expect(alert).toHaveAttribute('data-tone', 'warning')
    await expect(alert).toHaveTextContent('Certificate is being issued')
    await expect(alert).toHaveTextContent('certificate for the secure connection is being issued')
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
    await expect(alert).toHaveAttribute('data-tone', 'danger')
    await expect(alert).toHaveTextContent('DNS records not found yet')
    // The provider's own words stay behind "Technical details".
    const details = within(alert).getByText('Technical details')
    await expect(
      within(alert).getByText('custom hostname does not CNAME to this zone.'),
    ).not.toBeVisible()
    await userEvent.click(details)
    await expect(
      within(alert).getByText('custom hostname does not CNAME to this zone.'),
    ).toBeVisible()
  },
}

/** After a downgrade a proven domain is off until an upgrade, and kept: no release date. */
export const PlanLost: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'problem', 'plan')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveAttribute('data-tone', 'warning')
    await expect(alert).toHaveTextContent(
      /no longer includes your own domain.*as soon as you upgrade/,
    )
    await expect(canvas.queryByText(/Finish the setup by/)).toBeNull()
  },
}

/** The name is a custom hostname of another Cloudflare account: what to do about it. */
export const TakenOnCloudflare: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'problem', 'taken')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveAttribute('data-tone', 'danger')
    await expect(alert).toHaveTextContent(
      'connected to another service on Cloudflare. Remove it there, then re-check.',
    )
  },
}

/** Cloudflare blocked the hostname. */
export const Blocked: Story = {
  beforeEach: () => resetPortalDomain(portalDomain(undefined, 'problem', 'blocked')),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Contact support.')
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

/** A plan without custom domains: the row stays, locked, with why and the way to upgrade; nothing to type. */
export const PlanLocked: Story = {
  parameters: { msw: { handlers: [onPlan('pro'), ...portalDomainLockedHandlers] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('region', { name: 'Your portal on your own address' }),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Upgrade to Business' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/settings\/billing\/plans\/?$/),
    )
    await expect(canvas.getByRole('heading', { name: /Your own domain/ })).toBeVisible()
    await expect(canvas.queryByLabelText(/^Domain/)).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Add domain' })).toBeNull()
  },
}

/**
 * Pro with an operator's override of the feature: the API lists it (and the client portal it requires) among the
 * workspace's features, so the form is there as on Business, no upsell.
 */
export const ProWithOverride: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/billing', () => {
          const pro = billingFixture({ locked: false, plan: 'pro', status: 'active' })
          return HttpResponse.json({
            data: { ...pro, features: [...pro.features, 'client_portal', 'custom_portal_domain'] },
          })
        }),
        ...portalDomainHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByLabelText(/^Domain/)
    await expect(canvas.queryByRole('link', { name: 'Upgrade to Business' })).toBeNull()
    await userEvent.type(input, 'portal.firma.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Add domain' }))
    await expect(await canvas.findByText('Waiting for DNS')).toBeVisible()
  },
}

/** The API's refusals show at the field: a main domain, another workspace's, another Cloudflare account's. */
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
    await expect(await canvas.findByText(/domain service did not answer/)).toBeVisible()
    await userEvent.clear(input)
    await userEvent.type(input, 'portal.elsewhere.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Add domain' }))
    await expect(
      await canvas.findByText(/connected to another service on Cloudflare\. Remove it there first/),
    ).toBeVisible()
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

/** Without Cloudflare for SaaS settings on the server the row is not there. */
export const Disabled: Story = {
  beforeEach: () => resetPortalDomain(null, false),
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect(within(canvasElement).queryByText('Your own domain')).toBeNull()
  },
}

export const Dark: Story = { ...WaitingForDns, parameters: { ...meta.parameters, dark: true } }

const phone = {
  ...meta.parameters,
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}

export const WaitingForDnsPhone: Story = {
  ...WaitingForDns,
  parameters: phone,
  globals: { viewport: { value: 'phone' } },
}

export const CertificateDark: Story = {
  ...Certificate,
  parameters: { ...meta.parameters, dark: true },
}

export const ProblemDark: Story = { ...Problem, parameters: { ...meta.parameters, dark: true } }

export const ProblemPhone: Story = {
  ...Problem,
  parameters: phone,
  globals: { viewport: { value: 'phone' } },
}

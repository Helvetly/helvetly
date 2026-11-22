import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { PortalAddressSection } from '@/components/settings/portal-address'
import type { PlanId } from '@/lib/billing'
import { portalAddressHandlers, resetPortalAddress } from '@/mocks/portal-address'
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
  title: 'Settings/Portal address',
  component: PortalAddressSection,
  args: { canEdit: true },
  parameters: {
    msw: { handlers: [onPlan('business'), ...portalAddressHandlers, ...portalDomainHandlers] },
  },
  beforeEach: () => {
    resetPortalAddress()
    resetPortalDomain()
  },
  render: (args) => (
    <div className="@container/sections max-w-5xl p-6">
      <PortalAddressSection {...args} />
      <Toaster />
    </div>
  ),
} satisfies Meta<typeof PortalAddressSection>
export default meta
type Story = StoryObj<typeof meta>

const URL = 'https://portal.helvetly.com/w/mueller-treuhand/'
const page = () => within(document.body)
const slugInput = (canvas: ReturnType<typeof within>) => canvas.findByLabelText('Portal address')

/** One field: the fixed beginning inside it, the slug, and the copy button with its tooltip at its end. */
export const CopyAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await slugInput(canvas)).toHaveValue('mueller-treuhand')
    await expect(canvas.getByText('https://portal.helvetly.com')).toBeVisible()
    await expect(canvas.queryByText('Address')).toBeNull()
    await expect(canvas.queryByRole('status')).toBeEmptyDOMElement()
    const write = fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    })
    const copy = canvas.getByRole('button', { name: 'Copy address' })
    await userEvent.hover(copy)
    await expect(await page().findByRole('tooltip')).toHaveTextContent('Copy address')
    await userEvent.click(copy)
    await expect(write).toHaveBeenCalledWith(URL)
    await expect(await page().findByText('Portal address copied')).toBeInTheDocument()
  },
}

/** Typing checks the slug: Checking… with Save off, then Available; saving moves the address. */
export const ChangeSlug: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/workspace/portal/availability', async () => {
          await delay(400)
          return HttpResponse.json({ data: { available: true, problem: null } })
        }),
        onPlan('business'),
        ...portalAddressHandlers,
        ...portalDomainHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await slugInput(canvas)
    await userEvent.clear(input)
    await userEvent.type(input, 'mueller')
    await expect(await canvas.findByText('Checking…')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled()
    await expect(await canvas.findByText('Available')).toBeVisible()
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled())
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(await page().findAllByText('Portal address saved')).not.toHaveLength(0)
    await expect(await slugInput(canvas)).toHaveValue('mueller')
    await expect(canvas.queryByText('Available')).toBeNull()
  },
}

/** The check itself refused (too many checks): no status and Save stays possible, since saving checks again. */
export const CheckRateLimited: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/workspace/portal/availability', () =>
          HttpResponse.json(
            { error: { code: 'rate_limited', message: 'Too many address checks. Wait a moment.' } },
            { status: 429 },
          ),
        ),
        onPlan('business'),
        ...portalAddressHandlers,
        ...portalDomainHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await slugInput(canvas)
    await userEvent.clear(input)
    await userEvent.type(input, 'mueller')
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled())
    await expect(canvas.queryByText('Checking…')).toBeNull()
    await expect(canvas.queryByText('Available')).toBeNull()
  },
}

/** A slug the pattern refuses says why at once, without asking the server. */
export const InvalidSlug: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await slugInput(canvas)
    await userEvent.clear(input)
    await userEvent.type(input, '-ab')
    await expect(await canvas.findByText(/Use 3 to 32 lowercase letters/)).toBeVisible()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled()
  },
}

/** A reserved word is refused while typing. */
export const ReservedSlug: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await slugInput(canvas)
    await userEvent.clear(input)
    await userEvent.type(input, 'login')
    await expect(
      await canvas.findByText('This address is reserved. Choose another one.'),
    ).toBeVisible()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
  },
}

/** Another workspace's address (current or earlier) is taken: said while typing, Save stays off. */
export const TakenSlug: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await slugInput(canvas)
    await userEvent.clear(input)
    await userEvent.type(input, 'acme')
    await expect(
      await canvas.findByText('Another workspace uses this address. Choose another one.'),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled()
    // Back to the current slug: nothing to say, nothing to save.
    await userEvent.clear(input)
    await userEvent.type(input, 'mueller-treuhand')
    await waitFor(() => expect(canvas.queryByText(/Another workspace/)).toBeNull())
    await expect(canvas.queryByRole('button', { name: 'Save' })).toBeNull()
  },
}

/** Turning the whole portal off asks first; on again needs no question. */
export const TurnPortalOff: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByRole('switch', { name: /Client portal/ })
    await expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    const dialog = await page().findByRole('dialog')
    await expect(dialog).toHaveTextContent('Turn off the client portal?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    await expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await userEvent.click(
      within(await page().findByRole('dialog')).getByRole('button', { name: 'Turn off' }),
    )
    await waitFor(() => expect(toggle).not.toBeChecked())
    await expect(canvas.getByText(/nobody can sign in and no invitations go out/)).toBeVisible()
    await expect(await page().findByText('Client portal turned off')).toBeInTheDocument()
    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    await expect(page().queryByRole('dialog')).toBeNull()
  },
}

/** The portal is off: the switch says so; the address stays editable for when it is on again. */
export const PortalOff: Story = {
  beforeEach: () => {
    resetPortalAddress(undefined, false)
    resetPortalDomain()
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('switch', { name: /Client portal/ })).not.toBeChecked()
    await expect(canvas.getByText(/Off for every client/)).toBeVisible()
  },
}

/** Business with a domain on its way: the row under the address shows it and its records. */
export const WithDomain: Story = {
  beforeEach: () => {
    resetPortalAddress()
    resetPortalDomain(portalDomain())
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: /Your own domain/ })).toBeVisible()
    await expect(await canvas.findByText('Waiting for DNS')).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: /Copy value: portal.helvetly.com/ }),
    ).toBeVisible()
  },
}

/** Business without a domain: the domain to type and Add. */
export const DomainOnBusiness: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByLabelText(/^Domain/)).toBeEnabled()
    await expect(canvas.getByRole('button', { name: 'Add domain' })).toBeVisible()
  },
}

/** A lower plan: the domain row invites to Business, with the address it would give and the way to upgrade. */
export const DomainLocked: Story = {
  parameters: {
    msw: { handlers: [onPlan('pro'), ...portalAddressHandlers, ...portalDomainLockedHandlers] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = within(
      await canvas.findByRole('region', { name: 'Your portal on your own address' }),
    )
    await expect(card.getByText('Included in Business')).toBeVisible()
    await expect(card.getByText('portal.helvetly.com/w/mueller-treuhand')).toBeVisible()
    await expect(card.getByText('portal.yourfirm.ch')).toBeVisible()
    await expect(card.getByText('Free TLS certificate, renewed for you')).toBeVisible()
    const upgrade = card.getByRole('link', { name: 'Upgrade to Business' })
    await expect(upgrade).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/settings\/billing\/plans\/?$/),
    )
    await expect(card.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/settings\/billing\/plans\/?$/),
    )
    await expect(canvas.queryByLabelText(/^Domain/)).toBeNull()
  },
}

export const DomainLockedDark: Story = {
  ...DomainLocked,
  parameters: { ...DomainLocked.parameters, dark: true },
}

/** A member sees and copies the address, read-only, and cannot switch the portal. */
export const ReadOnly: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await slugInput(canvas)).toHaveAttribute('readonly')
    await expect(canvas.getByRole('button', { name: 'Copy address' })).toBeVisible()
    await expect(canvas.getByRole('switch', { name: /Client portal/ })).toBeDisabled()
    await expect(canvas.queryByRole('button', { name: 'Add domain' })).toBeNull()
  },
}

export const Dark: Story = { ...WithDomain, parameters: { ...meta.parameters, dark: true } }

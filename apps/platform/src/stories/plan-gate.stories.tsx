import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, screen, userEvent, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { ChoosePlan } from '@/components/shell/plan-gate'
import type { Billing } from '@/lib/billing'

import { screenHandlers, sessionHandler, storySession } from './screen-fixtures'

const handlers = (billing: Billing, role = 'owner') => [
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billing })),
  sessionHandler({ role }),
  http.get('/api/v1/session/workspaces', () => HttpResponse.json({ data: [] })),
  ...screenHandlers,
]

const meta = {
  title: 'Financial overview/Plan gate',
  render: () => <ChoosePlan />,
  parameters: {
    layout: 'fullscreen',
    ownMain: true,
    nextjs: { navigation: { pathname: '/choose-plan' } },
    msw: { handlers: handlers(billingFixture()) },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const phone = {
  viewport: {
    options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
  },
}
const mobile = { globals: { viewport: { value: 'phone' } } }

/** A new workspace: the picker with the trial on Basic, and nothing below the plans but the comparison-free footer. */
export const NewWorkspace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', {
        name: `Choose a plan for ${storySession.workspace.name}`,
      }),
    ).toBeVisible()
    // Per-person pricing, said as such.
    await expect(
      canvas.getByText(/One price per person, the whole team on the same plan\./),
    ).toBeVisible()
    await expect(canvas.queryByText(/One price per workspace/)).not.toBeInTheDocument()
    // No feature grid and no questions under the plans.
    await expect(
      canvas.queryByRole('heading', { name: 'Every plan includes' }),
    ).not.toBeInTheDocument()
    await expect(canvas.queryByRole('heading', { name: 'Questions' })).not.toBeInTheDocument()
    const pro = within(canvas.getByRole('region', { name: 'Pro' }))
    await expect(pro.getByText('Recommended')).toBeVisible()
    // Seats follow the workspace's people: a total for them, no control to pick another number.
    await expect(canvas.queryByRole('button', { name: 'More people' })).not.toBeInTheDocument()
    await expect(
      canvas.getByRole('region', { name: 'Pro' }).querySelector('[data-slot=team-total]'),
    ).toHaveTextContent('For 3 peopleCHF 147 / month')
  },
}

export const NewWorkspaceDark: Story = { ...NewWorkspace, parameters: { dark: true } }

export const NewWorkspaceMobile: Story = { ...NewWorkspace, parameters: phone, ...mobile }

/** A workspace whose plan lapsed: past the plans, its settings and, for its owner, deleting it in place. */
export const Lapsed: Story = {
  parameters: {
    msw: { handlers: handlers(billingFixture({ has_customer: true, payment_overdue: true })) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('region', { name: 'Pro' })).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: 'Workspace settings' }).getAttribute('href'),
    ).toMatch(/^\/settings\/workspace\/?$/)
    await userEvent.click(canvas.getByRole('button', { name: 'Delete workspace' }))
    const dialog = within(
      await screen.findByRole('dialog', { name: `Delete “${storySession.workspace.name}”?` }),
    )
    const confirm = dialog.getByRole('button', { name: 'Delete workspace' })
    await expect(confirm).toBeDisabled()
    await userEvent.type(dialog.getByRole('textbox'), storySession.workspace.name)
    await expect(confirm).toBeEnabled()
    await userEvent.click(dialog.getByRole('button', { name: 'Keep it' }))
    await expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  },
}

export const LapsedMobile: Story = {
  ...Lapsed,
  parameters: { ...Lapsed.parameters, ...phone },
  ...mobile,
}

/** An admin sees the workspace settings too, but deleting stays the owner's. */
export const LapsedAdmin: Story = {
  parameters: { msw: { handlers: handlers(billingFixture({ has_customer: true }), 'admin') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: 'Workspace settings' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Delete workspace' })).not.toBeInTheDocument()
  },
}

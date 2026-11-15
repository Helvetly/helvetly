import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { ChoosePlan } from '@/components/shell/plan-gate'
import type { Billing } from '@/lib/billing'

import { screenHandlers, storySession } from './screen-fixtures'

const handlers = (billing: Billing) => [
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billing })),
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
    await userEvent.click(canvas.getByRole('button', { name: 'More people' }))
    await expect(
      canvas.getByRole('region', { name: 'Pro' }).querySelector('[data-slot=team-total]'),
    ).toHaveTextContent('For 4 peopleCHF 196 / month')
  },
}

export const NewWorkspaceDark: Story = { ...NewWorkspace, parameters: { dark: true } }

export const NewWorkspaceMobile: Story = { ...NewWorkspace, parameters: phone, ...mobile }

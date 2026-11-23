import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { WorkspaceSwitcher } from '@/components/shell/app-sidebar'

import { screenHandlers, storySession } from './screen-fixtures'

const handlers = (plan: 'basic' | 'pro' | 'business', status = 'active') => [
  http.get('/api/v1/billing', () =>
    HttpResponse.json({ data: billingFixture({ enabled: true, locked: false, plan, status }) }),
  ),
  http.get('/api/v1/session/workspaces', () =>
    HttpResponse.json({
      data: [
        { ...storySession.workspace, role: 'owner', current: true, plan },
        { id: 'wrk_basic', name: 'Basic AG', role: 'owner', current: false, plan: 'basic' },
        { id: 'wrk_pro', name: 'Pro AG', role: 'owner', current: false, plan: 'pro' },
        { id: 'wrk_biz', name: 'Business AG', role: 'owner', current: false, plan: 'business' },
      ],
    }),
  ),
  ...screenHandlers,
]

const meta = {
  title: 'Design system/Workspace switcher',
  render: () => (
    <TooltipProvider>
      <SidebarProvider keyboardShortcut={false}>
        <div className="w-64 p-2">
          <WorkspaceSwitcher session={storySession} />
        </div>
      </SidebarProvider>
    </TooltipProvider>
  ),
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const open = (plan: 'basic' | 'pro' | 'business'): Story => ({
  parameters: { msw: { handlers: handlers(plan) } },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: /Muster AG/ })
    const badge = await within(trigger).findByTestId('workspace-plan')
    await waitFor(() => expect(badge).toHaveAttribute('data-plan', plan))
    // The trial lives in the plan card, never in the badge.
    await expect(badge).not.toHaveTextContent('Trial')
    await expect(badge.getBoundingClientRect().height).toBe(16)
    await userEvent.click(trigger)
    const row = await screen.findByRole('menuitem', { name: /Business AG/ })
    const rowBadge = row.querySelector('[data-slot="plan-badge"]')
    await expect(rowBadge).toHaveAttribute('data-plan', 'business')
    await expect(rowBadge?.getBoundingClientRect().height).toBe(16)
    // Close the menu again so the accessibility check sees the page, not Radix's aria-hidden siblings.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  },
})

export const BasicPlan: Story = open('basic')
export const ProPlan: Story = open('pro')
export const BusinessPlan: Story = open('business')

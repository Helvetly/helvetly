import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AppSidebar } from '@/components/shell/app-sidebar'
import type { Session } from '@/lib/api'

import { storySession } from './screen-fixtures'

const meta = {
  title: 'Shell/User menu',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/session/workspaces', () => HttpResponse.json({ data: [] })),
        http.get('/api/v1/billing', () =>
          HttpResponse.json({ data: { enabled: false, plans: [] } }),
        ),
      ],
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function withUser(name: string, email: string): Session {
  return { ...storySession, user: { ...storySession.user, name, email } }
}

function Sidebar({ session }: { session: Session }) {
  return (
    <div className="h-[560px]">
      <SidebarProvider keyboardShortcut={false}>
        <AppSidebar session={session} />
      </SidebarProvider>
    </div>
  )
}

async function openMenu(canvasElement: HTMLElement, name: RegExp) {
  await userEvent.click(await within(canvasElement).findByRole('button', { name }))
  const menu = await within(document.body).findByRole('menu')
  await waitFor(() => expect(menu).toBeVisible())
  return menu
}

async function expectContained(menu: HTMLElement, email: string) {
  const label = menu.firstElementChild as HTMLElement
  await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth)
  await expect(within(menu).getByTitle(email)).toBeVisible()
  await expect(within(menu).queryByText('Owner')).toBeNull()
}

/** A name that wraps to two lines and an email that truncates stay inside the popover; no role badge. */
export const LongNameAndEmail: Story = {
  render: () => (
    <Sidebar
      session={withUser(
        'Maximiliane Charlotte von Hohenzollern-Sigmaringen-Oberholzer',
        'maximiliane.charlotte.von.hohenzollern@a-very-long-company-domain-name.example.ch',
      )}
    />
  ),
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement, /Maximiliane/)
    await expectContained(
      menu,
      'maximiliane.charlotte.von.hohenzollern@a-very-long-company-domain-name.example.ch',
    )
  },
}

export const ShortName: Story = {
  render: () => <Sidebar session={withUser('Jo Li', 'jo@li.ch')} />,
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement, /Jo Li/)
    await expectContained(menu, 'jo@li.ch')
  },
}

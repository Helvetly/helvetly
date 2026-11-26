import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import { portalHandlers, portalSession } from '@/mocks/portal'
import { schedulingHandlers } from '@/mocks/scheduling'

import { PortalSessions } from './portal-sessions'
import { PortalShell } from './portal-shell'

const P = '/api/v1/public/portal'

/** Lorenzo, a participant of EuroChem Group AG: his own sessions and the documents shared with him, nothing else. */
const participantSession = (documents: boolean) =>
  http.get(`${P}/session`, () =>
    HttpResponse.json({
      ...portalSession,
      email: 'lorenzo@eurochem.ch',
      client: { id: 'cli_1', name: 'EuroChem Group AG' },
      clients: [
        {
          id: 'cli_1',
          name: 'EuroChem Group AG',
          workspace_name: 'Muster GmbH',
          participant_id: 'con_lorenzo',
          participant_name: 'Lorenzo Percic',
        },
      ],
      participant: { id: 'con_lorenzo', name: 'Lorenzo Percic', documents },
    }),
  )

const meta = {
  title: 'Portal/Participant',
  parameters: {
    ownMain: true,
    msw: { handlers: [participantSession(false), ...schedulingHandlers, ...portalHandlers] },
  },
  render: () => (
    <PortalShell>
      <PortalSessions />
    </PortalShell>
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Company mode: Sessions and Documents only; no overview, invoices, engagements or profile. */
export const SessionsOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = within(await canvas.findByRole('navigation', { name: 'Portal' }))
    await expect(nav.getByRole('link', { name: 'Sessions' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Documents' })).toBeVisible()
    for (const name of ['Overview', 'Invoices', 'Engagements']) {
      await expect(nav.queryByRole('link', { name })).toBeNull()
    }
    const account = canvas.getByRole('button', { name: /^Account menu, Lorenzo Percic/ })
    await userEvent.click(account)
    const menu = within(await within(document.body).findByRole('menu'))
    await expect(menu.getByText('Lorenzo Percic · EuroChem Group AG')).toBeVisible()
    await expect(menu.queryByRole('menuitem', { name: /Profile/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
  },
}

/** Participants mode: his invoices too. */
export const WithInvoices: Story = {
  parameters: {
    msw: { handlers: [participantSession(true), ...schedulingHandlers, ...portalHandlers] },
  },
  play: async ({ canvasElement }) => {
    const nav = within(await within(canvasElement).findByRole('navigation', { name: 'Portal' }))
    await expect(nav.getByRole('link', { name: 'Invoices' })).toBeVisible()
    await expect(nav.queryByRole('link', { name: 'Engagements' })).toBeNull()
  },
}

import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { DeletedWorkspaces } from '@/components/account/deleted-workspaces'

const item = {
  id: 'wdl_acme',
  workspace_id: 'wsp_acme',
  name: 'Acme AG',
  deleted_at: '2026-11-10T10:00:00Z',
  restore_until: '2026-12-10T10:00:00Z',
}
const list = (data: unknown[]) =>
  http.get('/api/v1/workspaces/deleted', () => HttpResponse.json({ data }))

const meta = {
  title: 'Account/Deleted workspaces',
  render: () => (
    <>
      <DeletedWorkspaces />
      <Toaster />
    </>
  ),
  parameters: { msw: { handlers: [list([item])] } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Listed: Story = {
  play: async ({ canvasElement }) => {
    const section = within(
      await within(canvasElement).findByRole('region', { name: 'Deleted workspaces' }),
    )
    await expect(section.getByText('Acme AG')).toBeVisible()
    await expect(section.getByText(/Deleted on .*, can be restored until /)).toBeVisible()
    await expect(section.getByRole('button', { name: 'Restore' })).toBeEnabled()
  },
}

export const EmptyHidden: Story = {
  parameters: { msw: { handlers: [list([])] } },
  play: async ({ canvasElement }) => {
    await delay(300)
    await expect(within(canvasElement).queryByText('Deleted workspaces')).toBeNull()
  },
}

export const RestorePending: Story = {
  parameters: {
    msw: {
      handlers: [
        list([item]),
        http.post('/api/v1/workspaces/deleted/wdl_acme/restore', async () => {
          await delay(800)
          return HttpResponse.json({ csrf_token: 'csrf_restored' })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Restore' }))
    await expect(canvas.getByRole('button', { name: 'Restoring…' })).toBeDisabled()
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Restoring…' })).toBeNull())
  },
}

export const RestoreGone: Story = {
  parameters: {
    msw: {
      handlers: [
        list([item]),
        http.post('/api/v1/workspaces/deleted/wdl_acme/restore', () =>
          HttpResponse.json(
            { error: { code: 'not_found', message: 'This workspace can no longer be restored.' } },
            { status: 404 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Restore' }))
    await expect(
      await within(document.body).findByText('This workspace can no longer be restored.'),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Restore' })).toBeEnabled()
  },
}

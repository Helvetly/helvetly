import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ChangeRequestBanner } from '@/components/clients/change-request-banner'
import { ClientDetail } from '@/components/clients/client-detail'
import type { ChangeRequest } from '@/lib/clients'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Clients/Change request',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const client = sampleClient({ billing_email: 'billing@alpenglow.ch', phone: '+41 44 123 45 67' })
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString()

const oneField: ChangeRequest = {
  id: 'r1',
  fields: { name: 'Alpenglow Studio AG' },
  current: { name: 'Alpenglow Studio GmbH' },
  contact: { id: 'c1', name: 'Lena Brunner' },
  created_at: hoursAgo(2),
}

const severalFields: ChangeRequest = {
  id: 'r2',
  fields: {
    name: 'Alpenglow Studio AG',
    billing_email: 'accounts@alpenglow.ch',
    phone: null,
    street: 'Hardturmstrasse',
    street_number: '201',
    zip: '8005',
  },
  current: {
    name: 'Alpenglow Studio GmbH',
    billing_email: 'billing@alpenglow.ch',
    phone: '+41 44 123 45 67',
    street: 'Seefeldstrasse',
    street_number: '88',
    zip: '8008',
  },
  contact: { id: 'c1', name: 'Lena Brunner' },
  created_at: hoursAgo(26),
}

const decided = fn()
const handlers = (request: ChangeRequest, hang?: 'approve' | 'reject') => {
  let open = true
  const decide = (action: 'approve' | 'reject') =>
    http.post(`/api/v1/clients/cli_1/change-request/${action}`, async ({ request: req }) => {
      decided(action, await req.json())
      if (hang === action) await delay('infinite')
      open = false
      return action === 'approve'
        ? HttpResponse.json({ data: client })
        : new HttpResponse(null, { status: 204 })
    })
  return [
    sessionHandler(),
    http.get('/api/v1/clients/cli_1', () => HttpResponse.json({ data: client })),
    http.get('/api/v1/clients/cli_1/change-request', () =>
      HttpResponse.json({ data: open ? request : null }),
    ),
    http.get('/api/v1/clients/cli_1/self-billing-agreements', () =>
      HttpResponse.json({ data: [] }),
    ),
    http.get('/api/v1/auth/config', () =>
      HttpResponse.json({ google: false, email: true, passkey: true, dev_codes: false }),
    ),
    decide('approve'),
    decide('reject'),
  ]
}

/** The notice at the client drawer's width, with the review drawer they open. */
const card = (canDecide = true) =>
  function Card() {
    const [reviewing, setReviewing] = useState(false)
    return (
      <div className="mx-auto grid max-w-[560px] gap-2 bg-background pb-5">
        <ChangeRequestBanner
          client={client}
          canDecide={canDecide}
          reviewing={reviewing}
          onReviewingChange={setReviewing}
        />
        <Toaster />
      </div>
    )
  }

const body = within(document.body)
/** Opens the review drawer from the notice's "Review". */
async function review(canvasElement: HTMLElement) {
  const notice = await within(canvasElement).findByRole('region', { name: 'Change request' })
  await userEvent.click(within(notice).getByRole('button', { name: 'Review' }))
  const drawer = await body.findByRole('dialog', { name: 'Profile change requested by the client' })
  await waitFor(() => expect(drawer).toBeVisible()) // after the slide-in's fade
  return within(drawer)
}

export const Notice: Story = {
  render: card(),
  parameters: { msw: { handlers: handlers(oneField) } },
  play: async ({ canvasElement }) => {
    const notice = await within(canvasElement).findByRole('region', { name: 'Change request' })
    await expect(notice).toHaveTextContent('Lena Brunner asked to change 1 field')
    await expect(notice).toHaveTextContent('2 hours ago')
    await expect(within(notice).queryByText('Alpenglow Studio AG')).toBeNull()
  },
}

export const ApproveOneField: Story = {
  render: card(),
  parameters: { msw: { handlers: handlers(oneField) } },
  play: async ({ canvasElement }) => {
    decided.mockClear()
    const drawer = await review(canvasElement)
    await expect(drawer.getByText('Alpenglow Studio AG')).toBeVisible()
    await expect(drawer.getByText(/Lena Brunner via client portal/)).toHaveTextContent(
      '2 hours ago',
    )
    await userEvent.click(drawer.getByRole('button', { name: 'Approve 1 change' }))
    await expect(await within(canvasElement).findByText('Changes applied')).toBeVisible()
    await expect(body.queryByRole('dialog')).toBeNull()
    await expect(decided).toHaveBeenCalledWith('approve', { fields: ['name'] })
    await expect(within(canvasElement).queryByRole('region', { name: 'Change request' })).toBeNull()
  },
}

export const ChooseWhichToApply: Story = {
  render: card(),
  parameters: { msw: { handlers: handlers(severalFields) } },
  play: async ({ canvasElement }) => {
    decided.mockClear()
    await expect(
      await within(canvasElement).findByRole('region', { name: 'Change request' }),
    ).toHaveTextContent('asked to change 4 fields')
    const drawer = await review(canvasElement)
    await expect(drawer.getByText('Hardturmstrasse 201')).toBeVisible()
    await expect(drawer.getByText('Removed')).toBeVisible()
    await userEvent.click(drawer.getByRole('checkbox', { name: 'Apply address' }))
    await userEvent.click(drawer.getByRole('checkbox', { name: 'Apply phone' }))
    await userEvent.click(drawer.getByRole('button', { name: 'Approve 2 changes' }))
    await expect(
      await within(canvasElement).findByText(/other changes were discarded/),
    ).toBeVisible()
    await expect(decided).toHaveBeenCalledWith('approve', { fields: ['name', 'billing_email'] })
  },
}

export const NothingChecked: Story = {
  render: card(),
  parameters: { msw: { handlers: handlers(oneField) } },
  play: async ({ canvasElement }) => {
    const drawer = await review(canvasElement)
    await userEvent.click(drawer.getByRole('checkbox', { name: 'Apply name' }))
    await expect(drawer.getByRole('button', { name: 'Approve 0 changes' })).toBeDisabled()
  },
}

export const RejectWithReason: Story = {
  render: card(),
  parameters: { msw: { handlers: handlers(severalFields) } },
  play: async ({ canvasElement }) => {
    decided.mockClear()
    const drawer = await review(canvasElement)
    await userEvent.click(drawer.getByRole('button', { name: 'Reject' }))
    const keep = within(await body.findByRole('dialog', { name: 'Reject the requested changes?' }))
    await userEvent.click(keep.getByRole('button', { name: 'Keep it' }))
    await expect(decided).not.toHaveBeenCalled()
    await userEvent.click(drawer.getByRole('button', { name: 'Reject' }))
    const confirm = within(
      await body.findByRole('dialog', { name: 'Reject the requested changes?' }),
    )
    await userEvent.type(
      confirm.getByLabelText('Reason for the client'),
      '  The VAT number belongs to another company. ',
    )
    await userEvent.click(confirm.getByRole('button', { name: 'Reject' }))
    await expect(await within(canvasElement).findByText('Request rejected')).toBeVisible()
    await expect(decided).toHaveBeenCalledWith('reject', {
      reason: 'The VAT number belongs to another company.',
    })
  },
}

export const PendingApprove: Story = {
  render: card(),
  parameters: { msw: { handlers: handlers(severalFields, 'approve') } },
  play: async ({ canvasElement }) => {
    const drawer = await review(canvasElement)
    await userEvent.click(drawer.getByRole('button', { name: 'Approve 4 changes' }))
    await expect(drawer.getByRole('button', { name: 'Approve 4 changes' })).toBeDisabled()
    await expect(drawer.getByRole('button', { name: 'Reject' })).toBeDisabled()
    await expect(drawer.getByRole('checkbox', { name: 'Apply name' })).toBeDisabled()
  },
}

export const PendingReject: Story = {
  render: card(),
  parameters: { msw: { handlers: handlers(severalFields, 'reject') } },
  play: async ({ canvasElement }) => {
    const drawer = await review(canvasElement)
    await userEvent.click(drawer.getByRole('button', { name: 'Reject' }))
    await userEvent.click(
      within(await body.findByRole('dialog', { name: 'Reject the requested changes?' })).getByRole(
        'button',
        { name: 'Reject' },
      ),
    )
    await expect(drawer.getByRole('button', { name: 'Reject' })).toBeDisabled()
    await expect(drawer.getByRole('button', { name: 'Approve 4 changes' })).toBeDisabled()
  },
}

export const MemberSeesNoDecision: Story = {
  render: card(false),
  parameters: { msw: { handlers: handlers(oneField) } },
  play: async ({ canvasElement }) => {
    const drawer = await review(canvasElement)
    await expect(drawer.queryByRole('button', { name: /Approve/ })).toBeNull()
    await expect(drawer.queryByRole('checkbox')).toBeNull()
    await expect(drawer.getByText(/owner or admin can approve/)).toBeVisible()
  },
}

export const ReviewDark: Story = {
  render: card(),
  parameters: { msw: { handlers: handlers(severalFields) }, dark: true },
  play: async ({ canvasElement }) => {
    await review(canvasElement)
  },
}

export const ReviewPhone: Story = {
  render: card(),
  parameters: {
    msw: { handlers: handlers(severalFields) },
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    await review(canvasElement)
  },
}

export const InTheClientDrawer: Story = {
  render: () => (
    <>
      <ClientDetail id="cli_1" canDelete onClose={fn()} onCommand={fn()} />
      <Toaster />
    </>
  ),
  parameters: { msw: { handlers: handlers(severalFields) } },
  play: async () => {
    const notice = await body.findByRole('region', { name: 'Change request' })
    await expect(notice).toHaveTextContent('Lena Brunner asked to change 4 fields')
    await userEvent.click(within(notice).getByRole('button', { name: 'Review' }))
    const drawer = await body.findByRole('dialog', {
      name: 'Profile change requested by the client',
    })
    await waitFor(() => expect(drawer).toBeVisible())
  },
}

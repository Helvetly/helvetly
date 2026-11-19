import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { accountChoice, portalAccounts, portalHandlers } from '@/mocks/portal'

import { PortalAccountChooser } from './portal-account-chooser'

const P = '/api/v1/public/portal'
const longAccounts = [
  {
    client_id: 'cli_1',
    client_name: 'Muster Beratung und Treuhand AG with a fairly long name',
    workspace_name: 'Müller Treuhand und Revision AG Zürich',
    logo_url: null,
  },
  ...portalAccounts.slice(1),
  {
    client_id: 'cli_8',
    client_name: 'Keller Holding GmbH',
    workspace_name: 'Architekturbüro Weissenstein & Partner',
    logo_url: null,
  },
]
const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}

const meta = {
  title: 'Portal/Account chooser',
  component: PortalAccountChooser,
  args: { email: 'anna@example.ch', accounts: portalAccounts, go: fn(), onBack: fn() },
  parameters: { msw: { handlers: [...accountChoice(), ...portalHandlers] } },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[27rem] p-4 sm:p-10">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PortalAccountChooser>
export default meta
type Story = StoryObj<typeof meta>

export const TwoAccounts: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Choose an account' })).toBeVisible()
    // Who signed in, with the way back to another address.
    await expect(canvas.getByText('Signed in as')).toBeVisible()
    await expect(canvas.getByText('anna@example.ch')).toBeVisible()
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(canvas.getByRole('button', { name: 'Studio Berg as Anna Keller' }))
    // Off to that supplier's own portal address, with its one-time ticket.
    await waitFor(() =>
      expect(args.go).toHaveBeenCalledWith(
        'https://portal.helvetly.com/w/cli_7/api/v1/public/portal/auth/handoff',
      ),
    )
  },
}

export const LongNames: Story = {
  args: { accounts: longAccounts },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The supplier's name is cut after 16 characters as in the header; the row still names it whole.
    await expect(canvas.getByText('Müller Treuhand…')).toBeVisible()
    const row = canvas.getByRole('button', {
      name: 'Müller Treuhand und Revision AG Zürich as Muster Beratung und Treuhand AG with a fairly long name',
    })
    await expect(row).toBeVisible()
    await userEvent.hover(canvas.getByText('Müller Treuhand…'))
    await expect(
      await within(document.body).findByRole('tooltip', {
        name: 'Müller Treuhand und Revision AG Zürich',
      }),
    ).toBeInTheDocument()
    // A short name gets no tooltip.
    await expect(canvas.getByText('Studio Berg')).toBeVisible()
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3)
  },
}

export const Phone: Story = {
  args: { accounts: longAccounts },
  globals: { viewport: { value: 'phone' } },
  parameters: phone,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3)
    // Long client names stay on one cut line: nothing pushes the page sideways.
    await Promise.all(
      canvas
        .getAllByRole('listitem')
        .map((row) => expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)),
    )
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

export const ChoiceExpired: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(`${P}/auth/choose`, () =>
          HttpResponse.json(
            { error: { code: 'unauthenticated', message: 'Sign in to continue.' } },
            { status: 401 },
          ),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Studio Berg as Anna Keller' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Sign in to continue.')
    await expect(args.go).not.toHaveBeenCalled()
    // Rows can be tried again.
    await expect(canvas.getByRole('button', { name: 'Studio Berg as Anna Keller' })).toBeEnabled()
  },
}

export const UseAnotherEmail: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Use another email' }))
    await expect(args.onBack).toHaveBeenCalledOnce()
    await expect(args.go).not.toHaveBeenCalled()
  },
}

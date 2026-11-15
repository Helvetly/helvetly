import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, spyOn, userEvent, waitFor, within } from 'storybook/test'

import { ApiTokens } from '@/components/api/api-tokens'
import { billingFixture } from '@/components/billing/billing-fixture'
import type { PlanId } from '@/lib/billing'
import { accountHandlers, resetAccountMock } from '@/mocks/account'

const created = fn()
const body = () => within(document.body)
const onPlan = (plan: PlanId) =>
  http.get('/api/v1/billing', () =>
    HttpResponse.json({ data: billingFixture({ locked: false, plan, status: 'active' }) }),
  )
const tokens = (handler: Parameters<typeof http.get>[1]) => ({
  msw: {
    handlers: [http.get('/api/v1/account/tokens', handler), onPlan('pro'), ...accountHandlers],
  },
})

const meta = {
  title: 'Settings/API tokens',
  render: () => (
    <div className="max-w-[880px]">
      <ApiTokens />
    </div>
  ),
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/account/tokens', async ({ request }) => {
          created(await request.clone().json())
        }),
        onPlan('pro'),
        ...accountHandlers,
      ],
    },
  },
  beforeEach: () => {
    resetAccountMock()
    created.mockClear()
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Name, access as compact badges, the prefix, workspace, created, last used and expiry. */
export const List: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Claude')).toBeVisible()
    await expect(canvas.getByText('Full access')).toBeVisible()
    await expect(canvas.getByText('Read everything')).toBeVisible()
    // A custom token: one badge per resource, writes tinted.
    await expect(canvas.getByText('Invoices and payments · write')).toBeVisible()
    await expect(canvas.getByText('Expenses · read')).toBeVisible()
    await expect(canvas.getByText('hvt_K7QM…')).toHaveClass('font-mono')
    await expect(
      canvas.getByText(/Side project · created .* · never used · never expires/),
    ).toBeVisible()
    // The API reference is a real link to the docs site, in a new tab.
    const reference = canvas.getByRole('link', { name: /API reference/ })
    await expect(reference).toHaveAttribute('href', 'https://docs.helvetly.com')
    await expect(reference).toHaveAttribute('target', '_blank')
    await expect(getComputedStyle(reference).textDecorationLine).toBe('underline')
    // The icon-only revoke button says what it does.
    await userEvent.hover(canvas.getByRole('button', { name: 'Revoke Claude' }))
    await expect(await body().findByRole('tooltip')).toHaveTextContent('Revoke token')
  },
}

export const ListDark: Story = { ...List, parameters: { dark: true } }

export const Empty: Story = {
  parameters: tokens(() => HttpResponse.json({ data: [] })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const empty = await canvas.findByText('No API tokens yet')
    await expect(empty).toBeVisible()
    // One "Create token", the empty state's primary action.
    const create = canvas.getAllByRole('button', { name: 'Create token' })
    await expect(create).toHaveLength(1)
    await expect(create[0]).toBeEnabled()
    await expect(empty.closest('[data-slot="settings-empty"]')?.contains(create[0] ?? null)).toBe(
      true,
    )
  },
}

/** A plan without API access: new tokens are locked behind the plan that has it; existing ones stay. */
export const LockedByPlan: Story = {
  parameters: { msw: { handlers: [onPlan('basic'), ...accountHandlers] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/New API tokens come with the Pro plan/)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/settings\/billing\/plans\/?$/),
    )
    await expect(canvas.getByRole('button', { name: 'Create token' })).toBeDisabled()
    // Tokens made before keep working and can still be revoked.
    await expect(await canvas.findByText('Claude')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Revoke Claude' })).toBeEnabled()
  },
}

export const Loading: Story = {
  parameters: tokens(async () => {
    await delay('infinite')
    return HttpResponse.json({ data: [] })
  }),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('Loading')).toBeInTheDocument()
  },
}

export const LoadFailed: Story = {
  parameters: tokens(() =>
    HttpResponse.json({ error: { code: 'internal', message: 'Try again.' } }, { status: 500 }),
  ),
  play: async ({ canvasElement }) => {
    const alert = await within(canvasElement).findByRole('alert')
    await expect(alert).toHaveTextContent('Couldn’t load your API tokens')
  },
}

/** The secret is shown once, with copy, a warning and how to use it; the list never shows it. */
export const Create: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Claude')
    await userEvent.click(canvas.getByRole('button', { name: 'Create token' }))
    const drawer = within(await body().findByRole('dialog', { name: 'Create API token' }))
    await userEvent.type(drawer.getByRole('textbox', { name: /Name/ }), 'Nightly export')
    // The summary says what the default (read everything) allows, and follows the choice.
    const summary = within(drawer.getByRole('region', { name: 'What this token can do' }))
    await expect(summary.getByText('Read everything')).toBeVisible()
    await expect(summary.getByText('Change nothing.')).toBeVisible()
    await userEvent.click(drawer.getByRole('radio', { name: 'Full access' }))
    await expect(summary.getByText('Create, edit and issue')).toBeVisible()
    await userEvent.click(drawer.getByRole('radio', { name: '1 year' }))
    await expect(summary.getByText(/^Works until /)).toBeVisible()
    await userEvent.click(drawer.getByRole('button', { name: 'Create token' }))

    const done = within(await body().findByRole('dialog', { name: 'Your new token' }))
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith({
        name: 'Nightly export',
        scopes: ['read:*', 'write:*'],
        expires_in_days: 365,
      }),
    )
    await expect(done.getByText('Copy it now')).toBeVisible()
    const secret = done.getByText(/^hvt_[A-Z2-7]{26}$/).textContent ?? ''
    await expect(done.getByText(`Authorization: Bearer ${secret}`)).toBeVisible()
    await expect(done.getByText(`${window.location.origin}/api/mcp`)).toBeVisible()
    // The assistant setups carry the real token.
    await expect(done.getByLabelText('Claude Code setup')).toHaveTextContent(secret)
    await userEvent.click(done.getByRole('tab', { name: 'Cursor' }))
    await expect(done.getByLabelText('Cursor setup')).toHaveTextContent(
      `"Authorization": "Bearer ${secret}"`,
    )
    const writeText = spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await userEvent.click(done.getByRole('button', { name: 'Copy Token' }))
    await expect(writeText).toHaveBeenCalledWith(secret)

    await userEvent.click(done.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
    await expect(await canvas.findByText('Nightly export')).toBeVisible()
    await expect(body().queryByText(secret)).toBeNull()
  },
}

export const CreateDark: Story = { ...Create, parameters: { ...meta.parameters, dark: true } }

export const CreatePhone: Story = {
  ...Create,
  parameters: {
    ...meta.parameters,
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
}

/** An empty name stops in the form, before any request. */
export const Validation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Claude')
    await userEvent.click(canvas.getByRole('button', { name: 'Create token' }))
    const drawer = within(await body().findByRole('dialog', { name: 'Create API token' }))
    await userEvent.type(drawer.getByRole('textbox', { name: /Name/ }), '   ')
    await userEvent.click(drawer.getByRole('button', { name: 'Create token' }))
    await expect(drawer.getByText('Enter a name.')).toBeVisible()
    await expect(drawer.getByRole('textbox', { name: /Name/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(created).not.toHaveBeenCalled()
  },
}

/** Revoking asks first; keeping it changes nothing. */
export const Revoke: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Revoke Claude' }))
    const ask = within(await body().findByRole('dialog', { name: 'Revoke “Claude”?' }))
    await userEvent.click(ask.getByRole('button', { name: 'Keep it' }))
    await expect(canvas.getByText('Claude')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Revoke Claude' }))
    const again = within(await body().findByRole('dialog', { name: 'Revoke “Claude”?' }))
    await userEvent.click(again.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(canvas.queryByText('Claude')).toBeNull())
    await expect(canvas.getByText('Monthly report script')).toBeVisible()
  },
}

/** Custom access: a resource × Read/Write matrix where write ticks read and unticking read clears write. */
export const CustomScopes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Claude')
    await userEvent.click(canvas.getByRole('button', { name: 'Create token' }))
    const drawer = within(await body().findByRole('dialog', { name: 'Create API token' }))
    await userEvent.type(drawer.getByRole('textbox', { name: /Name/ }), 'Bookkeeping')
    await userEvent.click(drawer.getByRole('radio', { name: 'Custom' }))
    const matrix = within(drawer.getByRole('table', { name: 'Custom access' }))
    // Nothing ticked yet: creating stops in the form.
    await userEvent.click(drawer.getByRole('button', { name: 'Create token' }))
    await expect(drawer.getByText('Choose at least one thing the token may read.')).toBeVisible()
    await expect(created).not.toHaveBeenCalled()

    await userEvent.click(matrix.getByRole('checkbox', { name: 'Write Invoices and payments' }))
    await expect(matrix.getByRole('checkbox', { name: 'Read Invoices and payments' })).toBeChecked()
    await expect(drawer.queryByText('Choose at least one thing the token may read.')).toBeNull()
    await userEvent.click(matrix.getByRole('checkbox', { name: 'Read Clients' }))
    await userEvent.click(matrix.getByRole('checkbox', { name: 'Write Clients' }))
    await userEvent.click(matrix.getByRole('checkbox', { name: 'Read Clients' }))
    await expect(matrix.getByRole('checkbox', { name: 'Write Clients' })).not.toBeChecked()
    await userEvent.click(matrix.getByRole('checkbox', { name: 'Read Expenses' }))
    // A resource the API cannot change has no Write box.
    await expect(matrix.getByRole('checkbox', { name: 'Read Reports (key figures)' })).toBeVisible()
    await expect(matrix.queryByRole('checkbox', { name: 'Write Reports (key figures)' })).toBeNull()

    const summary = within(drawer.getByRole('region', { name: 'What this token can do' }))
    await expect(summary.getByText('Invoices and payments, Expenses')).toBeVisible()
    await expect(summary.getByText('Invoices and payments')).toBeVisible()
    await userEvent.click(drawer.getByRole('button', { name: 'Create token' }))
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith({
        name: 'Bookkeeping',
        scopes: ['write:invoices', 'read:expenses'],
        expires_in_days: 90,
      }),
    )
    const done = within(await body().findByRole('dialog', { name: 'Your new token' }))
    await expect(
      done.getByText(/Bookkeeping · Invoices and payments · write, Expenses · read/),
    ).toBeVisible()
  },
}

export const CustomScopesDark: Story = {
  ...CustomScopes,
  parameters: { ...meta.parameters, dark: true },
}

export const CustomScopesPhone: Story = {
  ...CustomScopes,
  parameters: CreatePhone.parameters,
  globals: CreatePhone.globals,
}

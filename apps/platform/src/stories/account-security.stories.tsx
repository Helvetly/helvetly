import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { TwoFactorSignIn } from '@/components/auth/two-factor-sign-in'

const done = fn()
const meta = {
  title: 'Authentication/Second factor',
  render: () => (
    <div className="max-w-sm">
      <TwoFactorSignIn challengeId="abcdefghijklmnopqrstuvwxyz" onDone={done} onBack={fn()} />
    </div>
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const ValidationAndRecovery: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/auth/two-factor/verify', async ({ request }) => {
          const body: unknown = await request.json()
          if (
            typeof body === 'object' &&
            body !== null &&
            'code' in body &&
            body.code === 'abcde-fghij'
          )
            return HttpResponse.json({ csrf_token: 'csrf_test', next: '/clients' }, { status: 201 })
          return HttpResponse.json(
            { error: { code: 'invalid_code', message: 'That code is not valid.' } },
            { status: 422 },
          )
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: 'Authenticator or recovery code' })
    await userEvent.click(canvas.getByRole('button', { name: 'Verify and sign in' }))
    await expect(canvas.getByText(/Enter a 6-digit code/)).toBeVisible()
    await userEvent.type(input, '000000')
    await userEvent.click(canvas.getByRole('button', { name: 'Verify and sign in' }))
    await expect(await canvas.findByText('That code is not valid.')).toBeVisible()
    await expect(input).toHaveValue('')
    await expect(done).not.toHaveBeenCalled()
    await userEvent.type(input, 'abcde-fghij')
    await userEvent.click(canvas.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() =>
      expect(done).toHaveBeenCalledWith({ csrf_token: 'csrf_test', next: '/clients' }),
    )
  },
}

export const PendingVerification: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/auth/two-factor/verify', async () => {
          await delay(500)
          return HttpResponse.json({ csrf_token: 'csrf_test', next: '/' }, { status: 201 })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Authenticator or recovery code' }),
      '123456',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Verify and sign in' }))
    await expect(canvas.getByRole('button', { name: 'Checking…' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Start sign-in again' })).toBeDisabled()
    await waitFor(() => expect(done).toHaveBeenCalledWith({ csrf_token: 'csrf_test', next: '/' }))
  },
}

export const ExpiredChallenge: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/auth/two-factor/verify', () =>
          HttpResponse.json(
            {
              error: {
                code: 'two_factor_expired',
                message: 'This sign-in expired. Start sign-in again.',
              },
            },
            { status: 410 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Authenticator or recovery code' }),
      '123456',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Verify and sign in' }))
    await expect(
      await canvas.findByText('This sign-in expired. Start sign-in again.'),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Start sign-in again' })).toBeEnabled()
    await expect(done).not.toHaveBeenCalled()
  },
}

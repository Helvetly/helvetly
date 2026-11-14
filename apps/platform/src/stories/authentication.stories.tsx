import { EmailAddressForm, EmailCodeForm } from '@helvetly/ui/components/email-code'
import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ApiError } from '@/lib/api'

const meta = { title: 'Authentication/Email sign-in' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const sent = { expires_in: 600, resend_in: 30 }
const send = fn(async (_email?: string) => sent)
const onSent = fn()
export const EmailValidation: Story = {
  render: () => (
    <div className="max-w-sm">
      <EmailAddressForm send={send} onSent={onSent} autoComplete="email" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), 'invalid')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(canvas.getByText('Enter an email address such as ana@example.com.')).toBeVisible()
    await expect(send).not.toHaveBeenCalled()
  },
}

export const NormalizesEmail: Story = {
  render: () => (
    <div className="max-w-sm">
      <EmailAddressForm send={send} onSent={onSent} autoComplete="email" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), ' Anna@Example.COM ')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(send.mock.calls[0]?.[0]).toBe('anna@example.com')
    await expect(onSent).toHaveBeenCalledWith('anna@example.com', sent)
  },
}

const rejectCode = fn(async () => {
  throw new ApiError(401, 'code_invalid', 'Wrong code.', { attempts_left: 2 })
})
const done = fn()
export const WrongCodeAndCooldown: Story = {
  render: () => (
    <div className="max-w-sm">
      <EmailCodeForm
        email="anna@example.com"
        sent={sent}
        verify={rejectCode}
        resend={send}
        onDone={done}
        onBack={fn()}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: 'Code' })).toHaveFocus()
    await expect(canvas.getByRole('button', { name: /Resend code in/ })).toBeDisabled()
    await userEvent.type(canvas.getByRole('textbox', { name: 'Code' }), '123456')
    await expect(await canvas.findByText('That code is not right. 2 tries left.')).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Code' })).toHaveValue('')
    await expect(done).not.toHaveBeenCalled()
  },
}

export const ExpiredCode: Story = {
  render: () => (
    <div className="max-w-sm">
      <EmailCodeForm
        email="anna@example.com"
        sent={{ ...sent, resend_in: 0 }}
        verify={async () => {
          throw new ApiError(401, 'code_expired', 'Expired.')
        }}
        resend={send}
        onDone={done}
        onBack={fn()}
      />
      <Toaster />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Code' }), '654321')
    await expect(await canvas.findByText(/This code no longer works/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Resend code' }))
    // The new code is a toast (aria-live), not a line under the boxes, and the old error goes.
    await expect(await canvas.findByText('New code sent')).toBeInTheDocument() // the toast
    await expect(canvas.getByText('The previous one no longer works.')).toBeInTheDocument()
    await expect(canvas.queryByText(/This code no longer works/)).toBeNull()
    await expect(canvas.getByRole('button', { name: /Resend code in/ })).toBeDisabled()
  },
}

export const MailFailure: Story = {
  render: () => (
    <div className="max-w-sm">
      <EmailAddressForm
        autoComplete="email"
        onSent={onSent}
        send={async () => {
          throw new ApiError(502, 'mail_failed', 'Mail failed.')
        }}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), 'anna@example.com')
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(
      await canvas.findByText('The email could not be sent. Try again in a minute.'),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeEnabled()
  },
}

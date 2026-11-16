import { ApiError } from '@helvetly/ui/lib/http'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

import { EmailAddressForm, EmailCodeForm } from './email-code'
import { Toaster } from './sonner'

type Props = ComponentProps<typeof EmailCodeForm>

const signedIn = { csrf_token: 'token', next: '/' }

function renderForm(props: Partial<Props> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EmailCodeForm
        email="ana@example.com"
        sent={{ resend_in: 30, expires_in: 600 }}
        verify={vi.fn<Props['verify']>(async () => signedIn)}
        resend={vi.fn<Props['resend']>(async () => ({ resend_in: 30, expires_in: 600 }))}
        onDone={vi.fn<Props['onDone']>()}
        onBack={vi.fn<Props['onBack']>()}
        {...props}
      />
      <Toaster />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.useRealTimers())

test('submits by itself at six digits', async () => {
  const verify = vi.fn<Props['verify']>(async () => signedIn)
  const onDone = vi.fn<Props['onDone']>()
  renderForm({ verify, onDone })

  await userEvent.type(screen.getByLabelText('Code'), '12 34 56')

  expect(verify).toHaveBeenCalledOnce()
  expect(verify.mock.calls[0]?.[0]).toBe('123456')
  expect(onDone.mock.calls[0]?.[0]).toEqual(signedIn)
})

test('says how many tries are left after a wrong code', async () => {
  const verify = vi.fn<Props['verify']>(async () => {
    throw new ApiError(400, 'code_invalid', 'Wrong code.', { attempts_left: 2 })
  })
  renderForm({ verify })

  await userEvent.type(screen.getByLabelText('Code'), '000000')

  expect(await screen.findByText('That code is not right. 2 tries left.')).toBeInTheDocument()
  expect(screen.getByLabelText('Code')).toHaveValue('')
})

test('offers a new code once the countdown is over', () => {
  vi.useFakeTimers()
  renderForm({ sent: { resend_in: 3, expires_in: 600 } })

  expect(screen.getByRole('button', { name: 'Resend code in 3s' })).toBeDisabled()
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByRole('button', { name: 'Resend code in 2s' })).toBeDisabled()
  act(() => vi.advanceTimersByTime(2000))

  expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled()
})

test('a new code is announced in a toast, errors stay under the boxes', async () => {
  const resend = vi.fn<Props['resend']>(async () => ({ resend_in: 30, expires_in: 600 }))
  const verify = vi.fn<Props['verify']>(async () => {
    throw new ApiError(410, 'code_expired', 'Expired.')
  })
  renderForm({ sent: { resend_in: 0, expires_in: 600 }, resend, verify })

  await userEvent.type(screen.getByLabelText('Code'), '000000')
  expect(await screen.findByText(/This code no longer works/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Resend code' }))

  expect(await screen.findByText('New code sent')).toBeInTheDocument()
  expect(screen.getByText('The previous one no longer works.')).toBeInTheDocument()
  expect(screen.queryByText(/This code no longer works/)).not.toBeInTheDocument()
  expect(resend).toHaveBeenCalledOnce()
})

describe('EmailAddressForm cooldown recovery', () => {
  type AddressProps = ComponentProps<typeof EmailAddressForm>

  async function submit(error: unknown) {
    const send = vi.fn<AddressProps['send']>(async () => {
      throw error
    })
    const onSent = vi.fn<AddressProps['onSent']>()
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <EmailAddressForm send={send} onSent={onSent} autoComplete="email" />
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('Email'), ' Ana@Example.com ')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(send).toHaveBeenCalled())
    return onSent
  }

  test('a cooldown that reports the live code opens code entry with the real remaining times', async () => {
    const onSent = await submit(
      new ApiError(429, 'code_cooldown', 'wait', { resend_in: 12, expires_in: 540 }),
    )
    await waitFor(() =>
      expect(onSent).toHaveBeenCalledWith('ana@example.com', { resend_in: 12, expires_in: 540 }),
    )
    expect(screen.queryByText(/just sent/)).toBeNull()
  })

  test.each([
    ['cooldown without expires_in', new ApiError(429, 'code_cooldown', 'x', { resend_in: 12 })],
    ['cooldown without resend_in', new ApiError(429, 'code_cooldown', 'x', { expires_in: 540 })],
    ['zero expiry', new ApiError(429, 'code_cooldown', 'x', { resend_in: 12, expires_in: 0 })],
    [
      'negative resend',
      new ApiError(429, 'code_cooldown', 'x', { resend_in: -1, expires_in: 540 }),
    ],
    [
      'string expiry',
      new ApiError(429, 'code_cooldown', 'x', { resend_in: 12, expires_in: '540' }),
    ],
    ['absurd expiry', new ApiError(429, 'code_cooldown', 'x', { resend_in: 12, expires_in: 1e9 })],
    ['rate limit', new ApiError(429, 'rate_limited', 'x', { resend_in: 12, expires_in: 540 })],
    ['mail failure', new ApiError(503, 'mail_failed', 'x', { resend_in: 12, expires_in: 540 })],
    ['network error', new Error('offline')],
  ])('%s stays an error on the email step', async (_name, error) => {
    const onSent = await submit(error)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onSent).not.toHaveBeenCalled()
  })
})

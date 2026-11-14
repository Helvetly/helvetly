import { ApiError } from '@helvetly/ui/lib/http'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

import { EmailCodeForm } from './email-code'
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

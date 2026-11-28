import { Toaster } from '@helvetly/ui/components/sonner'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'

import { toastPlanRequired } from './plan-required-toast'
import { toastError } from './upgrade-prompt'

const refused = () => new ApiError(402, 'plan_required', 'This workspace has no active plan.')

// sonner's timers would fire after jsdom is gone: dismiss and flush them while the test still runs.
afterEach(() => {
  act(() => {
    toast.dismiss()
    vi.runOnlyPendingTimers()
  })
  vi.useRealTimers()
})

test('a plan_required refusal is one toast with the way to the plans', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const seePlans = vi.fn<() => void>()
  render(<Toaster />)
  expect(toastPlanRequired(new ApiError(409, 'conflict', 'Taken.'), seePlans)).toBe(false)
  expect(toastPlanRequired(refused(), seePlans)).toBe(true)
  expect(toastPlanRequired(refused(), seePlans)).toBe(true)
  expect(await screen.findAllByText('This workspace has no active plan.')).toHaveLength(1)
  // userEvent's pointer events need setPointerCapture, which jsdom lacks and sonner calls.
  fireEvent.click(screen.getByRole('button', { name: 'Compare plans' }))
  expect(seePlans).toHaveBeenCalledOnce()
})

test('a failed action’s own error toast stays away when the plan toast already explains it', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  render(<Toaster />)
  // What Providers' MutationCache does, then what the action's onError does.
  toastPlanRequired(refused(), () => {})
  toastError(refused())
  expect(await screen.findAllByText('This workspace has no active plan.')).toHaveLength(1)
})

test('a feature_not_in_plan refusal is the same toast, and the action’s own toast stays away', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const seePlans = vi.fn<() => void>()
  render(<Toaster />)
  const lacking = new ApiError(
    403,
    'feature_not_in_plan',
    'The Basic plan does not include expenses.',
    {
      feature: 'expenses',
      plan: 'basic',
      required_plan: 'pro',
    },
  )
  expect(toastPlanRequired(lacking, seePlans)).toBe(true)
  toastError(lacking)
  expect(await screen.findAllByText('The Basic plan does not include expenses.')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))
  expect(seePlans).toHaveBeenCalledOnce()
  // A 403 for a missing scope is not a plan refusal.
  expect(
    toastPlanRequired(new ApiError(403, 'forbidden', 'No.', { scope: 'write:invoices' }), seePlans),
  ).toBe(false)
})

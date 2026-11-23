import { toast } from 'sonner'

import { ApiError } from '@/lib/api'

import { failed, serverProblem } from './wizard-sheet'

vi.mock('sonner', () => ({ toast: { error: vi.fn<typeof toast.error>() } }))

test('a server refusal says its fields or message; anything else is a plain retry', () => {
  expect(
    serverProblem(
      new ApiError(422, 'validation_failed', 'x', { fields: { a: 'Use A.', b: 'Use B.' } }),
    ),
  ).toBe('Use A. Use B.')
  expect(serverProblem(new ApiError(503, 'ai_unavailable', 'AI is paused.'))).toBe('AI is paused.')
  expect(serverProblem(new TypeError("Cannot read properties of null (reading 'filter')"))).toBe(
    'Something went wrong. Try again.',
  )
})

test('a failure is a toast naming the action; a bug also goes to the console', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  failed('Couldn’t write the contract', new ApiError(503, 'ai_unavailable', 'AI is paused.'))
  expect(toast.error).toHaveBeenCalledWith('Couldn’t write the contract', {
    description: 'AI is paused.',
  })
  expect(log).not.toHaveBeenCalled()
  const bug = new TypeError('null')
  failed('Couldn’t write the contract', bug)
  expect(log).toHaveBeenCalledWith('Couldn’t write the contract', bug)
  log.mockRestore()
})

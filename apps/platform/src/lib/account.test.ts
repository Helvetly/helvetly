import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'

import { groupSecret, isOwnPhoto, lastActive, useDeleteAccount } from './account'

const now = new Date('2026-11-07T12:00:00Z')
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

test.each([
  [0, 'Active now'],
  [1, 'Active now'],
  [12, '12 min ago'],
  [60 * 3, '3 h ago'],
  [60 * 24, '1 day ago'],
  [60 * 24 * 6, '6 days ago'],
])('lastActive %i minutes ago is %s', (minutes, label) => {
  expect(lastActive(minutesAgo(minutes), now)).toBe(label)
})

test('lastActive shows the date after a week', () => {
  expect(lastActive(minutesAgo(60 * 24 * 9), now)).not.toMatch(/ago|now/)
})

test('groupSecret splits the key in fours', () => {
  expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP')
  expect(groupSecret('ABCDEF')).toBe('ABCD EF')
})

describe('isOwnPhoto', () => {
  it.each([
    ['/api/v1/users/usr_1/avatar?v=abcdef012345', true],
    ['https://lh3.googleusercontent.com/a/x', false],
    ['', false],
    [null, false],
  ])('%s', (url, want) => {
    expect(isOwnPhoto(url)).toBe(want)
  })
})

test('deleting the account forgets everything cached for it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 })),
  )
  const client = new QueryClient()
  client.setQueryData(['clients', 'list'], ['someone'])
  const { result } = renderHook(() => useDeleteAccount(), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  })
  await act(() => result.current.mutateAsync('me@example.test'))
  expect(client.getQueryData(['clients', 'list'])).toBeUndefined()
  vi.unstubAllGlobals()
})

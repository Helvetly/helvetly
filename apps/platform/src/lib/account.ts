'use client'
// The signed-in person's own settings, typed by hand from docs/auth-contract.md ("User settings").
// Account and passkey endpoints are served by Go; src/mocks/account.ts is a test-only fake.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request, type ApiError, type Session, type User } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { queryKeys } from '@/lib/queries'
import type { TokenScope } from '@/lib/token-scopes'

export type Provider = 'google' | 'email'
export type Identity = { provider: Provider; email: string; created_at: string }
export type Account = {
  identities: Identity[]
  two_factor: { enabled: boolean; recovery_codes_left: number }
}
export type TwoFactorSetup = { secret: string; otpauth_url: string; qr_svg: string | null }
export type DeviceKind = 'desktop' | 'mobile' | 'tablet'
export type AccountSession = {
  id: string
  browser: string
  os: string
  device: DeviceKind
  ip: string
  /** "Zurich, Switzerland"; null when the address could not be placed. */
  location: string | null
  workspace_name: string
  created_at: string
  last_active_at: string
  current: boolean
}

/** A personal API token (docs/api-tokens-contract.md); the secret itself only comes with create. */
export type ApiToken = {
  id: string
  name: string
  /** "read:*", "write:invoices"…: see lib/token-scopes. */
  scopes: TokenScope[]
  /** The secret's first 8 characters ("hvt_ABCD"), to recognise it. */
  prefix: string
  workspace: { id: string; name: string }
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}
export type NewApiToken = ApiToken & { token: string }
export type TokenExpiry = 30 | 90 | 365 | null
export type TokenInput = { name: string; scopes: TokenScope[]; expires_in_days: TokenExpiry }

const accountKey = ['account'] as const
const sessionsKey = ['account', 'sessions'] as const
const tokensKey = ['account', 'tokens'] as const
const json = (method: 'POST' | 'PATCH' | 'DELETE', body: unknown) => ({ method, json: body })

export function useAccount() {
  return useQuery({
    queryKey: accountKey,
    queryFn: async () => (await request<{ data: Account }>('/account')).data,
  })
}

export function useAccountSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: async () => (await request<{ data: AccountSession[] }>('/account/sessions')).data,
  })
}

/** Saves the name and puts it on the cached session, so the sidebar shows it at once. */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation<{ data: User }, ApiError, { name: string }>({
    mutationFn: (body) => request('/account', json('PATCH', body)),
    onSuccess: ({ data }) =>
      queryClient.setQueryData<Session>(queryKeys.session, (session) =>
        session ? { ...session, user: data } : session,
      ),
  })
}

/** An own photo's URL is served by the API (docs/auth-contract.md "Photo"); anything else is Google's picture. */
export const isOwnPhoto = (url: string | null | undefined) => !!url?.startsWith('/api/v1/users/')

/** Puts the new avatar on the cached session and refetches the team list, which shows it too. */
function useShowAvatar() {
  const queryClient = useQueryClient()
  return ({ avatar_url }: { avatar_url: string }) => {
    queryClient.setQueryData<Session>(queryKeys.session, (session) =>
      session ? { ...session, user: { ...session.user, avatar_url: avatar_url || null } } : session,
    )
    void queryClient.invalidateQueries({ queryKey: queryKeys.members })
  }
}

/** Uploads the person's own photo (PNG or JPEG, already shrunk) in place of Google's picture. */
export function useUploadPhoto() {
  return useMutation<{ avatar_url: string }, ApiError, Blob>({
    mutationFn: (photo) => {
      const form = new FormData()
      form.append('file', photo, photo.type === 'image/png' ? 'photo.png' : 'photo.jpg')
      return request('/account/avatar', { method: 'PUT', form })
    },
    onSuccess: useShowAvatar(),
  })
}

/** Removes the own photo; the answer is the fallback (Google's picture, else none). */
export function useRemovePhoto() {
  return useMutation<{ avatar_url: string }, ApiError, void>({
    mutationFn: () => request('/account/avatar', { method: 'DELETE' }),
    onSuccess: useShowAvatar(),
  })
}

/** Where to send the browser to link a Google account; it comes back to `next`. */
export function useConnectGoogle() {
  return useMutation<{ url: string }, ApiError, string>({
    mutationFn: (next) => request('/account/identities/google/start', json('POST', { next })),
    onSuccess: ({ url }) => window.location.assign(url),
  })
}

export function useDisconnect() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, Provider>({
    mutationFn: (provider) => request(`/account/identities/${provider}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKey }),
  })
}

export function useStartTwoFactor() {
  return useMutation<TwoFactorSetup, ApiError, void>({
    mutationFn: async () =>
      (await request<{ data: TwoFactorSetup }>('/account/two-factor/setup', json('POST', {}))).data,
  })
}

export function useEnableTwoFactor() {
  const queryClient = useQueryClient()
  return useMutation<string[], ApiError, string>({
    mutationFn: async (code) =>
      (
        await request<{ data: { recovery_codes: string[] } }>(
          '/account/two-factor/enable',
          json('POST', { code }),
        )
      ).data.recovery_codes,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKey }),
  })
}

export function useDisableTwoFactor() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (code) => request('/account/two-factor', json('DELETE', { code })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKey }),
  })
}

/** Signs out one other session, or with `null` every session but this one. */
export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string | null>({
    mutationFn: (id) =>
      request(id ? `/account/sessions/${encodeURIComponent(id)}` : '/account/sessions', {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey }),
  })
}

export function useApiTokens() {
  return useQuery({
    queryKey: tokensKey,
    queryFn: async () => (await request<{ data: ApiToken[] }>('/account/tokens')).data,
  })
}

/** Answers the new token with its secret, which the API never shows again. */
export function useCreateApiToken() {
  const queryClient = useQueryClient()
  return useMutation<NewApiToken, ApiError, TokenInput>({
    mutationFn: async (body) =>
      (await request<{ data: NewApiToken }>('/account/tokens', json('POST', body))).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey }),
  })
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => request(`/account/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey }),
  })
}

/** The session ends with the account: nothing of it may stay cached in this tab. */
export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (email) => request('/account', json('DELETE', { email })),
    onSuccess: () => queryClient.clear(),
  })
}

/** "Active now", "12 min ago", "3 h ago", "2 days ago", then the date. */
export function lastActive(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (minutes < 2) return translate('activeNow')
  if (minutes < 60) return translate('minAgo', { minutes: minutes })
  if (minutes < 24 * 60) return translate('hAgo', { value1: Math.floor(minutes / 60) })
  const days = Math.floor(minutes / (24 * 60))
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
}

/** The secret as an authenticator app shows it: groups of four. */
export const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret

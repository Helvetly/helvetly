'use client'

// Members, invitations and workspaces, typed by hand from docs/members-contract.md.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { ApiError, browserTimeZone, request, setCsrfToken } from '@/lib/api'

export type Role = 'owner' | 'admin' | 'member'

export type Member = {
  user_id: string
  name: string
  email: string
  avatar_url: string | null
  role: Role
  /** `null` for owners and admins (everything). */
  scopes: string[] | null
  joined_at: string
  last_active_at: string | null
  is_you: boolean
}
export type Invitation = {
  id: string
  email: string
  role: Role
  scopes: string[] | null
  invited_by: string
  created_at: string
  expires_at: string
}
export type InvitationCreated = Invitation & { url: string; email_sent: boolean }
export type InvitationPreview = {
  workspace_name: string
  invited_by: string
  email: string
  role: string
  status: 'open' | 'expired' | 'used'
}
export type WorkspaceItem = { id: string; name: string; role: string; current: boolean }

const ROLES: Role[] = ['owner', 'admin', 'member']

export const canManage = (role: string) => role === 'owner' || role === 'admin'

/** Mirrors the Go CanAssign: an admin never touches an owner nor assigns `owner`. */
export function assignableRoles(actor: string, targetRole: Role): Role[] {
  if (actor === 'owner') return ROLES
  if (actor === 'admin' && targetRole !== 'owner') return ['admin', 'member']
  return []
}

const keys = {
  members: ['members', 'list'],
  invitations: ['members', 'invitations'],
  workspaces: ['workspaces'],
} as const

const json = (method: 'POST' | 'PATCH', body: unknown) => ({ method, json: body }) as const
const path = (id: string) => encodeURIComponent(id)

export const membersQuery = {
  queryKey: keys.members,
  queryFn: async () => (await request<{ data: Member[] }>('/members')).data,
}

export const invitationsQuery = {
  queryKey: keys.invitations,
  queryFn: async () => (await request<{ data: Invitation[] }>('/members/invitations')).data,
}

export function useMembers() {
  return useQuery(membersQuery)
}

export function useInvitations() {
  return useQuery(invitationsQuery)
}

export function useInvite() {
  const queryClient = useQueryClient()
  return useMutation<
    InvitationCreated,
    ApiError,
    {
      email: string
      role: Role
      scopes?: string[]
      send_email: boolean
    }
  >({
    mutationFn: async (input) =>
      (await request<{ data: InvitationCreated }>('/members/invitations', json('POST', input)))
        .data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invitations }),
  })
}

export function useResendInvitation() {
  const queryClient = useQueryClient()
  return useMutation<InvitationCreated, ApiError, string>({
    mutationFn: async (id) =>
      (
        await request<{ data: InvitationCreated }>(
          `/members/invitations/${path(id)}/resend`,
          json('POST', undefined),
        )
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invitations }),
  })
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => request<void>(`/members/invitations/${path(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invitations }),
  })
}

export function useChangeRole() {
  const queryClient = useQueryClient()
  return useMutation<Member, ApiError, { user_id: string; role: Role }>({
    mutationFn: async ({ user_id, role }) =>
      (await request<{ data: Member }>(`/members/${path(user_id)}`, json('PATCH', { role }))).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.members }),
  })
}

export function useChangeScopes() {
  const queryClient = useQueryClient()
  return useMutation<Member, ApiError, { user_id: string; scopes: string[] }>({
    mutationFn: async ({ user_id, scopes }) =>
      (await request<{ data: Member }>(`/members/${path(user_id)}`, json('PATCH', { scopes })))
        .data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.members }),
  })
}

export function useRemoveMember() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (user_id) => request<void>(`/members/${path(user_id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.members }),
  })
}

export function useWorkspaces() {
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: async () => (await request<{ data: WorkspaceItem[] }>('/session/workspaces')).data,
  })
}

/**
 * Drops every cached answer of the old workspace. `clear()` alone is not enough: a page that stays
 * mounted (the dashboard when the switch happens on '/') keeps its old data until it re-renders.
 * Resetting also cancels old requests in flight and refetches what is on screen.
 */
function resetForNewSession(queryClient: QueryClient) {
  void queryClient.resetQueries()
}

/** A new session starts: keep its token and drop everything cached for the old workspace. */
function useNewSession(url: string, body: (value: string) => unknown) {
  const queryClient = useQueryClient()
  return useMutation<{ csrf_token: string }, ApiError, string>({
    mutationFn: (value) => request(url, json('POST', body(value))),
    onSuccess: (res) => {
      setCsrfToken(res.csrf_token)
      resetForNewSession(queryClient)
    },
  })
}

export const useSwitchWorkspace = () =>
  useNewSession('/session/workspace', (workspace_id) => ({ workspace_id }))

/** Creates a workspace with the person as owner and moves the session into it. */
export const useCreateWorkspace = () =>
  useNewSession('/workspaces', (name) => ({
    name,
    timezone: browserTimeZone(),
  }))

/**
 * Deletes the session's workspace (`confirm` is its name). The session moves to another of the
 * person's workspaces (`moved`), or ends when it was the last one.
 */
export function useDeleteWorkspace() {
  const queryClient = useQueryClient()
  return useMutation<{ moved: boolean }, ApiError, string>({
    mutationFn: async (confirm) => {
      const res = await request<{ csrf_token: string } | undefined>('/workspace', {
        method: 'DELETE',
        json: { confirm },
      })
      if (!res) return { moved: false }
      setCsrfToken(res.csrf_token)
      return { moved: true }
    },
    onSuccess: () => resetForNewSession(queryClient),
  })
}

export const useAcceptInvitation = () =>
  useNewSession('/invitations/accept', (token) => ({ token }))

export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ['invitations', 'preview', token],
    queryFn: async () =>
      (
        await request<{ data: InvitationPreview }>(
          `/invitations/preview?token=${encodeURIComponent(token)}`,
        )
      ).data,
    enabled: token !== '',
    retry: (count, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 3,
  })
}

/** The 422 `validation_failed` message for `scopes`, if that is what went wrong. */
export function scopesProblem(error: unknown): string | null {
  const fields = error instanceof ApiError && error.status === 422 ? error.details.fields : null
  const problem =
    typeof fields === 'object' && fields !== null ? Reflect.get(fields, 'scopes') : null
  return typeof problem === 'string' ? problem : null
}

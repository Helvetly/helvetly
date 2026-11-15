'use client'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { capitalize, formatDate } from '@helvetly/ui/lib/format'
import { Check, KeyRound, Link2, LogOut, Mail, RefreshCw, Trash2, UserX, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { LoadProblem } from '@/components/data/load-problem'
import { RowMenuButton, type RowMenuSpec } from '@/components/data/menus'
import { LoadingRows, State } from '@/components/data/table-page'
import { PageHeader } from '@/components/shell/page-header'
import { seatCostLabel, useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import {
  assignableRoles,
  canManage,
  useChangeRole,
  useInvitations,
  useMembers,
  useRemoveMember,
  useResendInvitation,
  useRevokeInvitation,
  type Invitation,
  type Member,
  type Role,
} from '@/lib/members'
import { useSession } from '@/lib/queries'

import { AccessDialog } from './access-dialog'
import { copyLink, InviteDialog } from './invite-dialog'
import { AccessBadge, InvitePanel, LastActive, MemberCell, TeamSummary } from './member-bits'

const TABS = [translate('all'), translate('invited')]
const TAB_ICONS = [Users, Mail]

type Pending =
  | { kind: 'remove' | 'leave'; member: Member }
  | { kind: 'revoke'; invitation: Invitation }

export function MembersPage() {
  const router = useRouter()
  const role = useSession().data?.role ?? ''
  const manager = canManage(role)
  const members = useMembers()
  const invitations = useInvitations()
  const changeRole = useChangeRole()
  const remove = useRemoveMember()
  const billing = useBilling().data
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()
  const [tab, setTab] = useState(0)
  const [inviting, setInviting] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [editing, setEditing] = useState<Member | null>(null)
  const [links, setLinks] = useState<Record<string, string>>({})

  const memberRows = tab === 1 ? [] : (members.data ?? [])
  const invitationRows = invitations.data ?? []
  const error = members.error ?? invitations.error
  const loading = !members.data || !invitations.data
  const alone = tab === 0 && members.data?.length === 1 && invitations.data?.length === 0
  const empty = memberRows.length + invitationRows.length === 0

  const memberRun = {
    setRole: (member: Member, next: Role) =>
      changeRole.mutate({ user_id: member.user_id, role: next }, { onError: toastError }),
    ask: setPending,
    editAccess: setEditing,
  }
  const invitationRun = {
    ask: setPending,
    resend: (invitation: Invitation) =>
      resend.mutate(invitation.id, {
        onSuccess: (sent) => {
          setLinks((current) => ({ ...current, [invitation.id]: sent.url }))
          toast.success(
            sent.email_sent
              ? translate('invitationSentAgain')
              : translate('emailNotSentCopyTheLink'),
          )
        },
        onError: toastError,
      }),
  }

  const decide = (approved: boolean) => {
    const current = pending
    setPending(null)
    if (!approved || !current) return
    if (current.kind === 'revoke')
      revoke.mutate(current.invitation.id, {
        onSuccess: () => toast.success(translate('invitationRevoked')),
        onError: toastError,
      })
    else
      remove.mutate(current.member.user_id, {
        // Leaving ends this session, so there is nothing left to show here.
        onSuccess: () => {
          if (current.kind === 'leave') router.replace('/login')
          else toast.success(translate('removed2', { name: current.member.name }))
        },
        onError: toastError,
      })
  }

  return (
    <>
      <PageHeader
        tabs={TABS}
        tabIcons={TAB_ICONS}
        savedViews={false}
        active={tab}
        onSelect={setTab}
        primary={manager ? translate('inviteMember') : undefined}
        onPrimary={() => setInviting(true)}
      />
      <div className="flex flex-1 flex-col">
        <TeamSummary members={members.data?.length ?? 0} pending={invitations.data?.length ?? 0} />
        {error ? (
          <LoadProblem
            error={error}
            what={translate('theTeam')}
            onRetry={() => {
              void members.refetch()
              void invitations.refetch()
            }}
          />
        ) : loading ? (
          <LoadingRows />
        ) : empty ? (
          <State
            icon={<UserX />}
            title={translate('nobodyHere')}
            text={translate('nobodyMatchesThisView')}
            action={null}
          />
        ) : (
          <table className="w-full table-fixed text-[15px]">
            <thead>
              <tr className="h-11 border-b bg-muted/50 text-left text-[13px] text-muted-foreground">
                <th className="w-[34%] pl-5 font-medium">{translate('member')}</th>
                <th className="w-[26%] px-3 font-medium">{translate('roleAndAccess')}</th>
                <th className="hidden w-[20%] px-3 font-medium @4xl:table-cell">
                  {translate('lastActive')}
                </th>
                <th className="w-[14%] px-3 font-medium">{translate('status')}</th>
                <th className="w-12">
                  <span className="sr-only">{translate('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {memberRows.map((member) => {
                const menu = memberMenu(member, manager ? role : '', memberRun)
                return (
                  <tr key={member.user_id} className="h-[62px] hover:bg-card/70">
                    <td className="pl-5">
                      <MemberCell
                        name={member.name}
                        detail={member.email}
                        url={member.avatar_url}
                        you={member.is_you}
                      />
                    </td>
                    <td className="px-3">
                      <span className="flex flex-wrap items-center gap-1">
                        <StatusBadge>{capitalize(member.role)}</StatusBadge>
                        <AccessBadge scopes={member.scopes} />
                      </span>
                    </td>
                    <td className="hidden px-3 @4xl:table-cell">
                      <LastActive iso={member.last_active_at} />
                    </td>
                    <td className="px-3">
                      <StatusBadge tone="green">{translate('active')}</StatusBadge>
                    </td>
                    <td className="pr-3 text-right">
                      {menu && (
                        <RowMenuButton
                          label={translate('actionsFor', { name: member.name })}
                          menu={menu}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
              {invitationRows.map((invitation) => (
                <tr key={invitation.id} className="h-[62px] hover:bg-card/70">
                  <td className="pl-5">
                    <MemberCell
                      name={invitation.email}
                      detail={translate('invitedBy', { invited_by: invitation.invited_by })}
                    />
                  </td>
                  <td className="px-3">
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusBadge>{capitalize(invitation.role)}</StatusBadge>
                      <AccessBadge scopes={invitation.scopes} />
                    </span>
                  </td>
                  <td className="hidden px-3 text-muted-foreground @4xl:table-cell">
                    {translate('expires3', { value1: formatDate(invitation.expires_at) })}
                  </td>
                  <td className="px-3">
                    <StatusBadge tone="blue">{translate('invited')}</StatusBadge>
                  </td>
                  <td className="pr-3 text-right">
                    {manager && (
                      <RowMenuButton
                        label={translate('actionsFor3', { email: invitation.email })}
                        menu={invitationMenu(invitation, links[invitation.id], invitationRun)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {alone && <InvitePanel onInvite={manager ? () => setInviting(true) : undefined} />}
      </div>
      {inviting && (
        <InviteDialog
          actorRole={role}
          onClose={() => setInviting(false)}
          onInvited={(created) =>
            setLinks((current) => ({ ...current, [created.id]: created.url }))
          }
        />
      )}
      {editing && <AccessDialog member={editing} onClose={() => setEditing(null)} />}
      {pending && (
        <ConfirmDialog
          {...confirmText(pending, billing && seatCostLabel(billing))}
          tone="destructive"
          onDecide={decide}
        />
      )}
    </>
  )
}

function memberMenu(
  member: Member,
  actor: string,
  run: {
    setRole: (member: Member, role: Role) => void
    ask: (pending: Pending) => void
    editAccess: (member: Member) => void
  },
): RowMenuSpec | null {
  const roles = assignableRoles(actor, member.role)
  if (roles.length === 0 && !member.is_you) return null
  return {
    title: member.name,
    items: ({ Item, Separator }) => (
      <>
        {roles.map((entry) => (
          <Item key={entry} onSelect={() => entry !== member.role && run.setRole(member, entry)}>
            {entry === member.role ? <Check /> : <span className="size-4" />} {capitalize(entry)}
          </Item>
        ))}
        {roles.length > 0 && member.role === 'member' && (
          <Item onSelect={() => run.editAccess(member)}>
            <KeyRound />
            {translate('changeAccess')}
          </Item>
        )}
        {roles.length > 0 && !member.is_you && <Separator />}
        {roles.length > 0 && !member.is_you && (
          <Item variant="destructive" onSelect={() => run.ask({ kind: 'remove', member })}>
            <UserX />
            {translate('removeFromWorkspace')}
          </Item>
        )}
        {member.is_you && (
          <>
            {roles.length > 0 && <Separator />}
            <Item variant="destructive" onSelect={() => run.ask({ kind: 'leave', member })}>
              <LogOut />
              {translate('leaveWorkspace2')}
            </Item>
          </>
        )}
      </>
    ),
  }
}

function invitationMenu(
  invitation: Invitation,
  link: string | undefined,
  run: { resend: (invitation: Invitation) => void; ask: (pending: Pending) => void },
): RowMenuSpec {
  return {
    title: invitation.email,
    items: ({ Item, Separator }) => (
      <>
        {link && (
          <Item onSelect={() => void copyLink(link)}>
            <Link2 />
            {translate('copyLink')}
          </Item>
        )}
        <Item onSelect={() => run.resend(invitation)}>
          <RefreshCw />
          {translate('resend')}
        </Item>
        <Separator />
        <Item variant="destructive" onSelect={() => run.ask({ kind: 'revoke', invitation })}>
          <Trash2 />
          {translate('revoke4')}
        </Item>
      </>
    ),
  }
}

function confirmText(pending: Pending, seatCost: string | null | undefined) {
  const saving = seatCost ? translate('savesProratedByStripe', { seatCost: seatCost }) : ''
  if (pending.kind === 'revoke')
    return {
      title: translate('revokeTheInvitationFor', { email: pending.invitation.email }),
      body: translate('theLinkStopsWorking'),
      confirmLabel: translate('revokeInvitation'),
    }
  if (pending.kind === 'leave')
    return {
      title: translate('leaveThisWorkspace'),
      body: translate('youLoseAccessUntilSomeoneInvitesYouAgain', { saving: saving }),
      confirmLabel: translate('leaveWorkspace'),
      confirmIcon: <LogOut />,
    }
  return {
    title: translate('remove3', { name: pending.member.name }),
    body: translate('theyLoseAccessToThisWorkspaceRightAway', { saving: saving }),
    confirmLabel: translate('removeMember'),
    confirmIcon: <UserX />,
  }
}

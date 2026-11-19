'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { capitalize, formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Check,
  KeyRound,
  Link2,
  ListFilter,
  LogOut,
  Mail,
  RefreshCw,
  SearchX,
  Trash2,
  UserX,
  Users,
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { listTable } from '@/components/data/list-table'
import { ListSearch, ListToolbar, ToolbarText } from '@/components/data/list-toolbar'
import { LoadProblem } from '@/components/data/load-problem'
import { RowMenuButton, type RowMenuSpec } from '@/components/data/menus'
import { LoadingRows, State } from '@/components/data/table-page'
import { PageHeader } from '@/components/shell/page-header'
import { seatCostLabel, useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import {
  assignableRoles,
  canManage,
  matchesTeamFilter,
  parseTeamFilter,
  ROLES,
  teamFilterToQuery,
  useChangeRole,
  useInvitations,
  useMembers,
  useRemoveMember,
  useResendInvitation,
  useRevokeInvitation,
  type Invitation,
  type Member,
  type Role,
  type TeamFilter,
} from '@/lib/members'
import { useSession } from '@/lib/queries'
import { setUrlQuery } from '@/lib/url-query'

import { AccessDialog } from './access-dialog'
import { copyLink, InviteDialog } from './invite-dialog'
import { AccessBadge, InvitePanel, LastActive, MemberCell, TeamSummary } from './member-bits'

const TABS = [translate('all'), translate('invited')]
const TAB_ICONS = [Users, Mail]

type Pending =
  | { kind: 'remove' | 'leave'; member: Member }
  | { kind: 'revoke'; invitation: Invitation }

/** The team list; the view, search and role filter live in the URL. */
export function MembersPage() {
  const router = useRouter()
  const pathname = usePathname()
  const query = useSearchParams()
  const filter = parseTeamFilter(query)
  const tab = filter.invited ? 1 : 0
  const [search, setSearch] = useState(filter.search)
  const role = useSession().data?.role ?? ''
  const manager = canManage(role)
  const members = useMembers()
  const invitations = useInvitations()
  const changeRole = useChangeRole()
  const remove = useRemoveMember()
  const billing = useBilling().data
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()
  const [inviting, setInviting] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [editing, setEditing] = useState<Member | null>(null)
  const [links, setLinks] = useState<Record<string, string>>({})

  const update = (change: Partial<TeamFilter>) =>
    setUrlQuery(pathname, teamFilterToQuery({ ...filter, ...change }, query))
  const filtered = Boolean(filter.search) || filter.roles.length > 0

  // Search waits for a pause in typing, then goes to the URL.
  useEffect(() => {
    if (search === filter.search) return
    const timer = setTimeout(() => update({ search }), 300)
    return () => clearTimeout(timer)
  })

  const memberRows =
    tab === 1 ? [] : (members.data ?? []).filter((row) => matchesTeamFilter(row, filter))
  const invitationRows = (invitations.data ?? []).filter((row) => matchesTeamFilter(row, filter))
  const error = members.error ?? invitations.error
  const loading = !members.data || !invitations.data
  const alone =
    tab === 0 && !filtered && members.data?.length === 1 && invitations.data?.length === 0
  const empty = memberRows.length + invitationRows.length === 0
  const owners = (members.data ?? []).filter((row) => row.role === 'owner').length

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
        onSelect={(index) => update({ invited: index === 1 })}
        primary={manager ? translate('inviteMember') : undefined}
        onPrimary={() => setInviting(true)}
      />
      <div className="flex flex-1 flex-col">
        <TeamSummary members={members.data?.length ?? 0} pending={invitations.data?.length ?? 0} />
        <ListToolbar>
          <RoleFilter roles={filter.roles} onChange={(roles) => update({ roles })} />
          <ListSearch
            label={translate('searchMembers')}
            placeholder={translate('searchNameOrEmail')}
            value={search}
            onChange={setSearch}
          />
        </ListToolbar>
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
        ) : empty && filtered ? (
          <State
            icon={<SearchX />}
            title={
              filter.search
                ? translate('nothingMatches', { search: filter.search })
                : translate('nothingInThisView')
            }
            text={translate('tryAnotherSearchOrClearTheFilters')}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch('')
                  update({ search: '', roles: [] })
                }}
              >
                {translate('clearSearchAndFilters')}
              </Button>
            }
          />
        ) : empty ? (
          <State
            icon={<UserX />}
            title={translate('nobodyHere')}
            text={translate('nobodyMatchesThisView')}
            action={null}
          />
        ) : (
          <table className={listTable.table}>
            <thead>
              <tr className={listTable.head}>
                <th className={cn(listTable.th, 'w-[34%]')}>{translate('member')}</th>
                <th className={cn(listTable.th, 'w-[26%]')}>{translate('roleAndAccess')}</th>
                <th className={cn(listTable.th, 'hidden w-[20%] @4xl:table-cell')}>
                  {translate('lastActive')}
                </th>
                <th className={cn(listTable.th, 'w-[14%]')}>{translate('status')}</th>
                <th className={listTable.menu}>
                  <span className="sr-only">{translate('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {memberRows.map((member) => {
                const menu = memberMenu(member, manager ? role : '', owners, memberRun)
                return (
                  <tr key={member.user_id} className={listTable.row}>
                    <td className={listTable.td}>
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
                        <AccessBadge role={member.role} scopes={member.scopes} />
                      </span>
                    </td>
                    <td className="hidden px-3 @4xl:table-cell">
                      <LastActive iso={member.last_active_at} />
                    </td>
                    <td className="px-3">
                      <StatusBadge tone="green">{translate('active')}</StatusBadge>
                    </td>
                    <td className={listTable.menu}>
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
                <tr key={invitation.id} className={listTable.row}>
                  <td className={listTable.td}>
                    <MemberCell
                      name={invitation.email}
                      detail={translate('invitedBy', { invited_by: invitation.invited_by })}
                    />
                  </td>
                  <td className="px-3">
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusBadge>{capitalize(invitation.role)}</StatusBadge>
                      <AccessBadge role={invitation.role} scopes={invitation.scopes} />
                    </span>
                  </td>
                  <td className="hidden px-3 text-muted-foreground @4xl:table-cell">
                    {translate('expires3', { value1: formatDate(invitation.expires_at) })}
                  </td>
                  <td className="px-3">
                    <StatusBadge tone="blue">{translate('invited')}</StatusBadge>
                  </td>
                  <td className={listTable.menu}>
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

/** The toolbar's Filters popover: one checkbox per role, as the invoices' status filter. */
function RoleFilter({ roles, onChange }: { roles: Role[]; onChange: (roles: Role[]) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-title-sm font-normal">
          <ListFilter className="stroke-[1.5]" />
          <ToolbarText>{translate('filters')}</ToolbarText>
          {roles.length > 0 && (
            <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-caption text-primary-foreground tabular-nums">
              {roles.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-72 gap-3 p-3">
        <fieldset className="grid gap-0.5">
          <legend className="px-2 pb-1 text-xs text-muted-foreground">{translate('role')}</legend>
          {ROLES.map((role) => (
            <label
              key={role}
              className="flex h-8 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-muted [&_[role=checkbox]]:bg-card"
            >
              <Checkbox
                checked={roles.includes(role)}
                onCheckedChange={() =>
                  onChange(
                    roles.includes(role)
                      ? roles.filter((entry) => entry !== role)
                      : ROLES.filter((entry) => entry === role || roles.includes(entry)),
                  )
                }
              />
              {capitalize(role)}
            </label>
          ))}
        </fieldset>
        {roles.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start text-muted-foreground"
            onClick={() => onChange([])}
          >
            {translate('clearFilters')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function memberMenu(
  member: Member,
  actor: string,
  owners: number,
  run: {
    setRole: (member: Member, role: Role) => void
    ask: (pending: Pending) => void
    editAccess: (member: Member) => void
  },
): RowMenuSpec | null {
  // The last owner can neither change their role nor leave (the API answers 409 last_owner).
  const lastOwner = member.role === 'owner' && owners === 1
  const roles = lastOwner ? [] : assignableRoles(actor, member.role)
  if (roles.length === 0 && (!member.is_you || lastOwner)) return null
  return {
    title: member.name,
    items: ({ Item, Separator }) => (
      <>
        {roles.map((entry) => (
          <Item key={entry} onSelect={() => entry !== member.role && run.setRole(member, entry)}>
            {entry === member.role ? <Check /> : <span className="size-4" />} {capitalize(entry)}
          </Item>
        ))}
        {/* An admin's access editor holds only the HR rows, which only an owner changes. */}
        {roles.length > 0 &&
          (member.role === 'member' || (member.role === 'admin' && actor === 'owner')) && (
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

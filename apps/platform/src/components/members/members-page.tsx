'use client'
import type { Action } from '@helvetly/ui/components/action-menu'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DataTable, type DataColumn } from '@helvetly/ui/components/data-table'
import { capitalize, formatDate } from '@helvetly/ui/lib/format'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import {
  Check,
  KeyRound,
  Link2,
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
import { ListFilters } from '@/components/data/list-filters'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import { LoadProblem } from '@/components/data/load-problem'
import { RowMenuButton, type RowMenuSpec } from '@/components/data/menus'
import { LoadingRows, State } from '@/components/data/table-page'
import { PageHeader } from '@/components/shell/page-header'
import { seatCostLabel, useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import { among, type QueryField } from '@/lib/list-query'
import { parseSort, sortParam, sortRows } from '@/lib/list-sort'
import {
  assignableRoles,
  canManage,
  matchesTeamFilter,
  parseTeamFilter,
  DEFAULT_TEAM_SORT,
  ROLES,
  TEAM_SORTS,
  teamFilterToQuery,
  teamSortValue,
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
  type TeamSortField,
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

  const sort = parseSort(query.get('sort'), TEAM_SORTS, DEFAULT_TEAM_SORT)
  const sortBy = (field: TeamSortField, desc: boolean) => {
    const next = new URLSearchParams(query)
    const value = sortParam({ field, desc }, DEFAULT_TEAM_SORT)
    if (value) next.set('sort', value)
    else next.delete('sort')
    setUrlQuery(pathname, next)
  }
  const ordered = <Row extends Member | Invitation>(rows: Row[]) =>
    sortRows(
      rows.filter((row) => matchesTeamFilter(row, filter)),
      (row) => teamSortValue(row, sort.field),
      sort.desc,
    )
  const memberRows = tab === 1 ? [] : ordered(members.data ?? [])
  const invitationRows = ordered(invitations.data ?? [])
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
          <ListFilters fields={QUERY_FIELDS} params={filter} onChange={update} />
          <ListSearch
            label={translate('searchMembers')}
            placeholder={translate('searchNameOrEmail')}
            value={search}
            onChange={setSearch}
            query={{ fields: QUERY_FIELDS, params: filter, onChange: update }}
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
          <DataTable
            id="members"
            columns={teamColumns((row) => {
              if (row.kind === 'invitation')
                return manager
                  ? {
                      label: translate('actionsFor3', { email: row.invitation.email }),
                      menu: invitationMenu(row.invitation, links[row.invitation.id], invitationRun),
                    }
                  : null
              const menu = memberMenu(row.member, manager ? role : '', owners, memberRun)
              return menu && { label: translate('actionsFor', { name: row.member.name }), menu }
            })}
            data={[
              ...memberRows.map((member): TeamRow => ({ kind: 'member', member })),
              ...invitationRows.map((invitation): TeamRow => ({ kind: 'invitation', invitation })),
            ]}
            getRowId={(row) =>
              row.kind === 'member'
                ? `member:${row.member.user_id}`
                : `invitation:${row.invitation.id}`
            }
            sorting={{
              column: sort.field,
              desc: sort.desc,
              onSort: (column, desc) => {
                const field = TEAM_SORTS.find((entry) => entry === column)
                if (field) sortBy(field, desc)
              },
            }}
          />
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
          {...confirmText(pending, billing && seatCostLabel(billing, billing.seats))}
          tone="destructive"
          onDecide={decide}
        />
      )}
    </>
  )
}

/** The toolbar's Filters popover: one checkbox per role, as the invoices' status filter. */
/** One row of the team list: a member, or an invitation still open. */
type TeamRow = { kind: 'member'; member: Member } | { kind: 'invitation'; invitation: Invitation }

function teamColumns(
  actions: (row: TeamRow) => { label: string; menu: RowMenuSpec } | null,
): DataColumn<TeamRow>[] {
  return [
    {
      id: 'member',
      header: translate('member'),
      flex: true,
      sortable: true,
      cell: (row) =>
        row.kind === 'member' ? (
          <MemberCell
            name={row.member.name}
            detail={row.member.email}
            url={row.member.avatar_url}
            you={row.member.is_you}
          />
        ) : (
          <MemberCell
            name={row.invitation.email}
            detail={translate('invitedBy', { invited_by: row.invitation.invited_by })}
          />
        ),
    },
    {
      id: 'role',
      header: translate('roleAndAccess'),
      size: 260,
      minSize: 160,
      sortable: true,
      cell: (row) => {
        const { role, scopes } = row.kind === 'member' ? row.member : row.invitation
        return (
          <span className="flex flex-wrap items-center gap-1">
            <Badge>{capitalize(role)}</Badge>
            <AccessBadge role={role} scopes={scopes} />
          </span>
        )
      },
    },
    {
      id: 'active',
      header: translate('lastActive'),
      size: 168,
      minSize: 112,
      sortable: true,
      sortDescFirst: true,
      showFrom: 850,
      cell: (row) =>
        row.kind === 'member' ? (
          <LastActive iso={row.member.last_active_at} />
        ) : (
          <span className="text-muted-foreground">
            {translate('expires3', { value1: formatDate(row.invitation.expires_at) })}
          </span>
        ),
    },
    {
      id: 'status',
      header: translate('status'),
      size: 112,
      cell: (row) =>
        row.kind === 'member' ? (
          <Badge tone={STATUS_TONES.member.active}>{translate('active')}</Badge>
        ) : (
          <Badge tone={STATUS_TONES.member.invited}>{translate('invited')}</Badge>
        ),
    },
    {
      id: 'actions',
      header: translate('actions'),
      headerContent: <span className="sr-only">{translate('actions')}</span>,
      size: 48,
      cell: (row) => {
        const menu = actions(row)
        return menu && <RowMenuButton label={menu.label} menu={menu.menu} />
      },
    },
  ]
}

/** The search's field term `role:`. */
const QUERY_FIELDS: QueryField<TeamFilter>[] = [
  {
    id: 'role',
    label: translate('role'),
    type: 'enum',
    values: ROLES.map((role) => ({ value: role, label: capitalize(role) })),
    placeholder: translate('anyRole'),
    get: (filter) => filter.roles,
    set: (roles) => ({ roles: among(ROLES, roles) }),
  },
]

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
    header: member.name,
    actions: [
      ...roles.map((entry): Action => ({
        id: `role:${entry}`,
        group: 'status',
        icon: entry === member.role ? <Check /> : <span className="size-4" />,
        label: capitalize(entry),
        onSelect: () => entry !== member.role && run.setRole(member, entry),
      })),
      // An admin's access editor holds only the HR rows, which only an owner changes.
      roles.length > 0 &&
        (member.role === 'member' || (member.role === 'admin' && actor === 'owner')) && {
          id: 'access',
          group: 'edit',
          icon: <KeyRound />,
          label: translate('changeAccess'),
          onSelect: () => run.editAccess(member),
        },
      roles.length > 0 &&
        !member.is_you && {
          id: 'remove',
          group: 'danger',
          icon: <UserX />,
          label: translate('removeFromWorkspace'),
          onSelect: () => run.ask({ kind: 'remove', member }),
        },
      member.is_you && {
        id: 'leave',
        group: 'danger',
        icon: <LogOut />,
        label: translate('leaveWorkspace2'),
        onSelect: () => run.ask({ kind: 'leave', member }),
      },
    ],
  }
}

function invitationMenu(
  invitation: Invitation,
  link: string | undefined,
  run: { resend: (invitation: Invitation) => void; ask: (pending: Pending) => void },
): RowMenuSpec {
  return {
    header: invitation.email,
    actions: [
      {
        id: 'resend',
        group: 'send',
        icon: <RefreshCw />,
        label: translate('resend'),
        onSelect: () => run.resend(invitation),
      },
      link
        ? {
            id: 'copy',
            group: 'send',
            icon: <Link2 />,
            label: translate('copyLink'),
            onSelect: () => void copyLink(link),
          }
        : null,
      {
        id: 'revoke',
        group: 'danger',
        icon: <Trash2 />,
        label: translate('revoke4'),
        onSelect: () => run.ask({ kind: 'revoke', invitation }),
      },
    ],
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

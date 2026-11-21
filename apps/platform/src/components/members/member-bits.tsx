import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate, formatRelative } from '@helvetly/ui/lib/format'
import { Users } from 'lucide-react'
import Link from 'next/link'

import { UserAvatar } from '@/components/user-avatar'
import { useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import { PRESETS, presetOf } from '@/lib/permissions'

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/** Name with the email (or other context) as a second line; "You" marks the signed-in person. */
export function MemberCell({
  name,
  detail,
  url,
  you,
}: {
  name: string
  detail: string
  url?: string | null
  you?: boolean
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <UserAvatar name={name} url={url} className="size-8" />
      <span className="min-w-0 leading-tight">
        <span className="flex items-center gap-1.5">
          <span className="truncate">{name}</span>
          {you && <Badge size="sm">{translate('you2')}</Badge>}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">{detail}</span>
      </span>
    </span>
  )
}

/** "2 days ago", with the exact date on hover. */
export function LastActive({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">—</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default">{formatRelative(iso)}</span>
      </TooltipTrigger>
      <TooltipContent>{formatDate(iso)}</TooltipContent>
    </Tooltip>
  )
}

/** Counts, and seats used of the plan's limit when billing is on. */
export function TeamSummary({ members, pending }: { members: number; pending: number }) {
  const seats = useBilling().data?.usage.find((item) => item.limit === 'members')
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-5 text-[13px] text-muted-foreground">
      <span>
        {plural(members, 'member')} · {plural(pending, translate('pendingInvitation'))}
      </span>
      {seats?.max != null && (
        <span>
          {seats.used}
          {translate('of5')}
          {seats.max}
          {translate('seatsUsed')}{' '}
          <Link href="/settings/billing/plans" className="text-foreground underline">
            {translate('upgrade')}
          </Link>
        </span>
      )}
    </div>
  )
}

const RULES = [
  translate('ownersAndAdminsInvitePeopleChangeRolesAndManage'),
  translate('membersWorkWithClientsInvoicesAndDocuments'),
  translate('anyoneCanLeaveTheLastOwnerStays'),
]

/** Shown while the owner is alone, so the page invites instead of sitting empty. */
export function InvitePanel({ onInvite }: { onInvite?: () => void }) {
  return (
    <section className="m-5 flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Users className="size-4.5" />
      </span>
      <h2 className="text-[15px] font-medium">{translate('workTogether')}</h2>
      <p className="text-[14px] text-muted-foreground">
        {translate('inviteYourAccountantOrTeamEveryoneGetsTheirOwn')}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-[14px] text-muted-foreground">
        {RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      {onInvite && (
        <Button size="sm" className="cursor-pointer" onClick={onInvite}>
          {translate('inviteMember')}
        </Button>
      )}
    </section>
  )
}

/** The preset a member's scopes amount to, or "Custom"; owners and admins have full access (an admin's scopes are
 * only their HR list). */
export function AccessBadge({ role, scopes }: { role: string; scopes: string[] | null }) {
  const preset = PRESETS.find((entry) => entry.id === presetOf(role === 'member' ? scopes : null))
  return <Badge>{preset?.label ?? translate('custom')}</Badge>
}

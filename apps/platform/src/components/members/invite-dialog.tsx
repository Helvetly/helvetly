'use client'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { capitalize } from '@helvetly/ui/lib/format'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { seatCostLabel, useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import {
  assignableRoles,
  scopesProblem,
  useInvite,
  type InvitationCreated,
  type Role,
} from '@/lib/members'
import { ADMIN_HR, EVERYTHING } from '@/lib/permissions'

import { AccessEditor } from './access-editor'

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success(translate('linkCopied'))
  } catch {
    toast.error(translate('couldNotCopyTheLinkSelectItAndCopy'))
  }
}

const ROLE_TEXT: Record<Role, string> = {
  owner: translate('everythingIncludingBillingAndDeletingTheWorkspace'),
  admin: translate('managesMembersSettingsAndBillingWorksWithAllData'),
  member: translate('worksWithTheDataYouGiveThemAccessTo'),
}

/**
 * Email, role, (for members) access, and how it reaches them: by email (the sheet closes, the link
 * stays under the row's Copy link) or as a link to share, also shown when the email fails.
 */
export function InviteDialog({
  actorRole,
  onClose,
  onInvited,
}: {
  actorRole: string
  onClose: () => void
  onInvited?: (created: InvitationCreated) => void
}) {
  const roles = assignableRoles(actorRole, 'member')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [scopes, setScopes] = useState<string[]>(EVERYTHING)
  const [adminHR, setAdminHR] = useState<string[]>(ADMIN_HR)
  const [by, setBy] = useState<'email' | 'link'>('email')
  const [problem, setProblem] = useState<string | null>(null)
  const [created, setCreated] = useState<InvitationCreated | null>(null)
  const invite = useInvite()
  const billing = useBilling().data
  const cost = billing && seatCostLabel(billing)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setProblem(null)
    invite.mutate(
      // Owners have everything; an admin has every general area and, unless the owner picks otherwise, payroll view.
      {
        email: email.trim(),
        role,
        send_email: by === 'email',
        ...(role === 'member' && { scopes }),
        ...(role === 'admin' && adminHR.join() !== ADMIN_HR.join() && { scopes: adminHR }),
      },
      {
        onSuccess: (sent) => {
          onInvited?.(sent)
          if (!sent.email_sent) return setCreated(sent)
          toast.success(translate('invitationSentTo2', { email: sent.email }))
          onClose()
        },
        onError: (error) => {
          const scopeProblem = scopesProblem(error)
          if (scopeProblem) setProblem(scopeProblem)
          else toastError(error)
        },
      },
    )
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(600px,calc(100vw-6rem))]! dark:bg-card"
      >
        <div className="grid shrink-0 gap-0.5 border-b px-5 py-4 pr-12 md:px-8">
          <SheetTitle className="text-lg font-semibold">{translate('inviteMember')}</SheetTitle>
          <SheetDescription className="text-[13px]">
            {translate('theyJoinThisWorkspaceWithTheRoleYouPick')}
          </SheetDescription>
        </div>
        {created ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid flex-1 content-start gap-3 overflow-y-auto px-5 py-6 md:px-8">
              <div className="grid gap-1">
                <p className="text-sm font-medium">
                  {by === 'link'
                    ? translate('invitationLinkFor', { email: created.email })
                    : translate('theEmailToDidnTGoOut', { email: created.email })}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {translate('sendThemThisLinkYourselfItWorksFor7')}
                </p>
              </div>
              <div className="flex gap-2">
                <Input readOnly aria-label={translate('invitationLink')} value={created.url} />
                <Button variant="outline" onClick={() => void copyLink(created.url)}>
                  {translate('copy5')}
                </Button>
              </div>
            </div>
            <div className="flex shrink-0 justify-end border-t px-5 py-3 md:px-7">
              <Button onClick={onClose}>{translate('done')}</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 py-6 md:px-8">
              <FormField id="invite-email" label={translate('email')} required>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  placeholder={translate('colleagueExampleCh')}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FormField>
              <div className="grid justify-items-start gap-1.5">
                <span className="text-[13px] font-medium">{translate('howToInvite')}</span>
                <Segmented
                  label={translate('howToInvite')}
                  value={by}
                  options={[
                    { value: 'email', label: translate('byEmail') },
                    { value: 'link', label: translate('byLink') },
                  ]}
                  onChange={setBy}
                />
                <p className="text-xs text-muted-foreground">
                  {by === 'email'
                    ? translate('weEmailThemTheInvitation')
                    : translate('youGetALinkToShareYourselfNoEmail')}
                </p>
              </div>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-[13px] font-medium">{translate('role')}</legend>
                {roles.map((entry) => (
                  <label
                    key={entry}
                    htmlFor={`invite-role-${entry}`}
                    className="grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 rounded-lg border p-2.5 text-[13px] has-checked:border-ring has-checked:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring/50"
                  >
                    <input
                      id={`invite-role-${entry}`}
                      type="radio"
                      name="invite-role"
                      value={entry}
                      checked={role === entry}
                      onChange={() => setRole(entry)}
                      className="mt-0.5 size-4 accent-foreground"
                    />
                    <span className="font-medium">{capitalize(entry)}</span>
                    <span className="col-start-2 text-muted-foreground">{ROLE_TEXT[entry]}</span>
                  </label>
                ))}
              </fieldset>
              {role !== 'owner' && (
                <div className="grid gap-1.5">
                  <span className="text-[13px] font-medium">{translate('access')}</span>
                  <AccessEditor
                    key={role}
                    value={role === 'admin' ? adminHR : scopes}
                    onChange={role === 'admin' ? setAdminHR : setScopes}
                    error={problem}
                    canChangeHR={actorRole === 'owner'}
                    admin={role === 'admin'}
                  />
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-2 border-t px-5 py-3 md:px-7">
              {cost && (
                <p className="mr-auto text-xs text-pretty text-muted-foreground">
                  {translate('adds')}
                  {cost}
                  {translate('onceAccepted')}
                </p>
              )}
              <Button type="button" variant="ghost" onClick={onClose}>
                {translate('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={invite.isPending || (role === 'member' && scopes.length === 0)}
              >
                {by === 'email' ? translate('sendInvitation') : translate('createLink')}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}

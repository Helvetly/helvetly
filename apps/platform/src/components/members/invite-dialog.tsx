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
import {
  assignableRoles,
  scopesProblem,
  useInvite,
  type InvitationCreated,
  type Role,
} from '@/lib/members'
import { EVERYTHING } from '@/lib/permissions'

import { AccessEditor } from './access-editor'

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Link copied.')
  } catch {
    toast.error('Could not copy the link. Select it and copy by hand.')
  }
}

const ROLE_TEXT: Record<Role, string> = {
  owner: 'Everything, including billing and deleting the workspace.',
  admin: 'Manages members, settings and billing; works with all data.',
  member: 'Works with the data you give them access to.',
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
      // Owners and admins always have everything: the API refuses scopes for them.
      {
        email: email.trim(),
        role,
        send_email: by === 'email',
        ...(role === 'member' && { scopes }),
      },
      {
        onSuccess: (sent) => {
          onInvited?.(sent)
          if (!sent.email_sent) return setCreated(sent)
          toast.success(`Invitation sent to ${sent.email}.`)
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
          <SheetTitle className="text-lg font-semibold">Invite member</SheetTitle>
          <SheetDescription className="text-[13px]">
            They join this workspace with the role you pick, after signing in with this address.
          </SheetDescription>
        </div>
        {created ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid flex-1 content-start gap-3 overflow-y-auto px-5 py-6 md:px-8">
              <div className="grid gap-1">
                <p className="text-sm font-medium">
                  {by === 'link'
                    ? `Invitation link for ${created.email}`
                    : `The email to ${created.email} didn’t go out`}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Send them this link yourself. It works for 7 days, only for someone signed in with
                  that address.
                </p>
              </div>
              <div className="flex gap-2">
                <Input readOnly aria-label="Invitation link" value={created.url} />
                <Button variant="outline" onClick={() => void copyLink(created.url)}>
                  Copy
                </Button>
              </div>
            </div>
            <div className="flex shrink-0 justify-end border-t px-5 py-3 md:px-7">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 py-6 md:px-8">
              <FormField id="invite-email" label="Email" required>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  placeholder="colleague@example.ch"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FormField>
              <div className="grid justify-items-start gap-1.5">
                <span className="text-[13px] font-medium">How to invite</span>
                <Segmented
                  label="How to invite"
                  value={by}
                  options={[
                    { value: 'email', label: 'By email' },
                    { value: 'link', label: 'By link' },
                  ]}
                  onChange={setBy}
                />
                <p className="text-xs text-muted-foreground">
                  {by === 'email'
                    ? 'We email them the invitation.'
                    : 'You get a link to share yourself; no email is sent.'}
                </p>
              </div>
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-[13px] font-medium">Role</legend>
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
              {role === 'member' && (
                <div className="grid gap-1.5">
                  <span className="text-[13px] font-medium">Access</span>
                  <AccessEditor
                    value={scopes}
                    onChange={setScopes}
                    error={problem}
                    canChangeHR={actorRole === 'owner'}
                  />
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-2 border-t px-5 py-3 md:px-7">
              {cost && (
                <p className="mr-auto text-xs text-pretty text-muted-foreground">
                  Adds {cost} once accepted
                </p>
              )}
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={invite.isPending || (role === 'member' && scopes.length === 0)}
              >
                {by === 'email' ? 'Send invitation' : 'Create link'}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}

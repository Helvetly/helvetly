'use client'

import { Button } from '@helvetly/ui/components/button'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MailX, UserPlus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

import { State } from '@/components/data/table-page'
import { PageHeader } from '@/components/shell/page-header'
import { api, ApiError, errorMessage, setCsrfToken } from '@/lib/api'
import { useAcceptInvitation, useInvitationPreview } from '@/lib/members'
import { useSession } from '@/lib/queries'
import { loginHref } from '@/lib/safe'

/** Where a signed-in person lands from an invitation email: accept it into a new session. */
export function AcceptInvitation() {
  const token = useSearchParams().get('token') ?? ''
  const router = useRouter()
  const queryClient = useQueryClient()
  const session = useSession().data
  const preview = useInvitationPreview(token)
  const accept = useAcceptInvitation()
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSettled: () => {
      setCsrfToken('')
      queryClient.clear()
      router.replace(loginHref(`/invite?token=${encodeURIComponent(token)}`))
    },
  })

  const invitation = preview.data
  const error = accept.error
  const mismatch = error instanceof ApiError && error.code === 'invitation_email_mismatch'
  const expired =
    invitation?.status === 'expired' || (error instanceof ApiError && error.status === 410)

  let body
  if (preview.isPending && token !== '') {
    body = null
  } else if (!invitation || invitation.status === 'used') {
    body = (
      <State
        icon={<MailX />}
        title="This invitation link is not valid"
        text="It may have been used already or withdrawn. Ask for a new invitation."
        action={null}
      />
    )
  } else if (expired) {
    body = (
      <State
        icon={<MailX />}
        title="This invitation has expired"
        text={`This invitation has expired. Ask ${invitation.invited_by} for a new one.`}
        action={null}
      />
    )
  } else {
    body = (
      <State
        icon={<UserPlus />}
        title={`${invitation.invited_by} invited you to join ${invitation.workspace_name} as ${invitation.role}`}
        text={
          mismatch
            ? `This invitation is for ${String(error.details.email ?? invitation.email)}. You're signed in as ${session?.user.email ?? ''}.`
            : error
              ? errorMessage(error)
              : 'Accept to add this workspace to your account.'
        }
        action={
          mismatch ? (
            <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
              Sign out
            </Button>
          ) : (
            <Button
              disabled={accept.isPending}
              onClick={() => accept.mutate(token, { onSuccess: () => router.replace('/') })}
            >
              Accept
            </Button>
          )
        }
      />
    )
  }

  return (
    <>
      <PageHeader
        tabs={['Join workspace']}
        tabIcons={[UserPlus]}
        savedViews={false}
        actions={<span />}
      />
      <div role={error ? 'alert' : undefined} className="flex flex-1">
        {body}
      </div>
    </>
  )
}

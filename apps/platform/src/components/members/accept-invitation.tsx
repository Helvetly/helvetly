'use client'
import { Button } from '@helvetly/ui/components/button'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MailX, UserPlus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

import { State } from '@/components/data/table-page'
import { PageHeader } from '@/components/shell/page-header'
import { api, ApiError, errorMessage, setCsrfToken } from '@/lib/api'
import { translate } from '@/lib/i18n'
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
        title={translate('thisInvitationLinkIsNotValid')}
        text={translate('itMayHaveBeenUsedAlreadyOrWithdrawnAsk')}
        action={null}
      />
    )
  } else if (expired) {
    body = (
      <State
        icon={<MailX />}
        title={translate('thisInvitationHasExpired')}
        text={translate('thisInvitationHasExpiredAskForANewOne', {
          invited_by: invitation.invited_by,
        })}
        action={null}
      />
    )
  } else {
    body = (
      <State
        icon={<UserPlus />}
        title={translate('invitedYouToJoinAs', {
          invited_by: invitation.invited_by,
          workspace_name: invitation.workspace_name,
          role: invitation.role,
        })}
        text={
          mismatch
            ? translate('thisInvitationIsForYouReSignedInAs', {
                value1: String(error.details.email ?? invitation.email),
                value2: session?.user.email ?? '',
              })
            : error
              ? errorMessage(error)
              : translate('acceptToAddThisWorkspaceToYourAccount')
        }
        action={
          mismatch ? (
            <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
              {translate('signOut')}
            </Button>
          ) : (
            <Button
              disabled={accept.isPending}
              onClick={() => accept.mutate(token, { onSuccess: () => router.replace('/') })}
            >
              {translate('accept')}
            </Button>
          )
        }
      />
    )
  }

  return (
    <>
      <PageHeader
        tabs={[translate('joinWorkspace')]}
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

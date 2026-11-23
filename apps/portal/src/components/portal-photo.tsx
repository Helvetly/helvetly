'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { ApiError, errorMessage } from '@helvetly/ui/lib/http'
import { PHOTO_TYPES, photoProblem, shrinkPhoto } from '@helvetly/ui/lib/photo'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageUp, LoaderCircle, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'
import {
  deletePortalAvatar,
  getPortalSession,
  portalKeys,
  uploadPortalAvatar,
  type PortalSession,
} from '@/lib/portal'

import { cardClass, LoginAvatar } from './portal-bits'
import { PreviewLock } from './portal-shell'

/** The login's photo on the profile: upload, change or remove it; the account menu follows at once. */
export function PortalPhoto() {
  const queryClient = useQueryClient()
  const { data: session } = useQuery({ queryKey: portalKeys.session, queryFn: getPortalSession })
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const show = (avatarUrl: string) =>
    queryClient.setQueryData<PortalSession | null>(portalKeys.session, (current) =>
      current ? { ...current, avatar_url: avatarUrl } : current,
    )
  const upload = useMutation({
    mutationFn: async (file: File) => uploadPortalAvatar(await shrinkPhoto(file)),
    onSuccess: ({ avatar_url }) => {
      show(avatar_url)
      toast.success(translate('photoSaved'))
    },
    onError: (failure) => setError(errorMessage(failure)),
  })
  const remove = useMutation({
    mutationFn: async () => {
      try {
        await deletePortalAvatar()
      } catch (failure) {
        // Already gone (another tab removed it): the outcome the person asked for.
        if (!(failure instanceof ApiError && failure.status === 404)) throw failure
      }
    },
    onSuccess: () => {
      show('')
      toast.success(translate('photoRemoved'))
    },
    onError: (failure) => setError(errorMessage(failure)),
  })
  if (!session) return null

  const busy = upload.isPending || remove.isPending
  const pick = (file: File | undefined) => {
    if (!file) return
    const problem = photoProblem(file)
    setError(problem ?? '')
    if (!problem) upload.mutate(file)
  }

  return (
    <section
      aria-labelledby="portal-photo-title"
      className={cn(cardClass, 'flex flex-wrap items-center gap-4 p-4 sm:p-6')}
    >
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="portal-photo-input"
        onChange={(event) => {
          pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <LoginAvatar name={session.client.name} src={session.avatar_url} large />
      <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
        <h2 id="portal-photo-title" className="text-title-sm font-medium">
          {translate('photo')}
        </h2>
        <p className="text-body-sm text-pretty text-muted-foreground">
          {translate('shownInYourAccountMenuInsteadOfYourInitials')}
        </p>
        {error && <InlineError>{error}</InlineError>}
      </div>
      <div className="flex flex-wrap gap-2">
        <PreviewLock>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {upload.isPending ? (
              <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : (
              <ImageUp aria-hidden />
            )}
            {upload.isPending
              ? translate('uploading')
              : session.avatar_url
                ? translate('changePhoto')
                : translate('uploadPhoto')}
          </Button>
        </PreviewLock>
        {session.avatar_url && (
          <PreviewLock>
            <Button
              type="button"
              variant="destructive-ghost"
              disabled={busy}
              onClick={() => {
                setError('')
                setConfirming(true)
              }}
            >
              <Trash2 aria-hidden />
              {translate('remove')}
            </Button>
          </PreviewLock>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          tone="destructive"
          title={translate('removeYourPhoto')}
          body={translate('yourInitialsShowInsteadYouCanUploadANew')}
          confirmLabel={translate('removePhoto')}
          onDecide={(approved) => {
            setConfirming(false)
            if (approved) remove.mutate()
          }}
        />
      )}
    </section>
  )
}

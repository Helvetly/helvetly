'use client'
import { Avatar, AvatarFallback, AvatarImage } from '@helvetly/ui/components/avatar'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { PHOTO_TYPES, photoProblem } from '@helvetly/ui/lib/photo'
import { Camera, ImageUp, LoaderCircle, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { PhotoCropDialog } from '@/components/account/photo-crop'
import { initialsOf } from '@/components/initials'
import { isOwnPhoto, useRemovePhoto, useUploadPhoto } from '@/lib/account'
import { errorMessage, type User } from '@/lib/api'
import { translate } from '@/lib/i18n'

/** A picked photo being cropped: the file and a local URL to show it. */
type Draft = { file: File; url: string }

/**
 * The person's photo on the profile: click it (or "Upload photo") to pick an image, crop it to a square, save it.
 * An own photo replaces Google's picture everywhere the person is shown; removing it brings that picture back.
 */
export function ProfilePhoto({ user, name }: { user: User; name: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const upload = useUploadPhoto()
  const remove = useRemovePhoto()

  useEffect(
    () => () => {
      if (draft) URL.revokeObjectURL(draft.url)
    },
    [draft],
  )

  const own = isOwnPhoto(user.avatar_url)
  const busy = upload.isPending || remove.isPending
  const choose = () => input.current?.click()
  const action = own ? translate('changePhoto') : translate('uploadPhoto')

  const pick = (file: File | undefined) => {
    if (!file) return
    const problem = photoProblem(file)
    setError(problem ?? '')
    if (!problem) setDraft({ file, url: URL.createObjectURL(file) })
  }

  const cancel = () => {
    setDraft(null)
    upload.reset()
  }

  const save = (photo: Blob) =>
    upload.mutate(photo, {
      onSuccess: () => {
        setDraft(null)
        toast.success(translate('photoSaved'))
      },
    })

  const hint = own
    ? translate('yourOwnPhotoShownToYourTeamWhereverYou')
    : user.avatar_url
      ? translate('yourGooglePictureUploadAPhotoToUseAnother')
      : translate('uploadAPhotoToShowInsteadOfYourInitials')

  return (
    <div className="flex flex-wrap items-center gap-4">
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="profile-photo-input"
        onChange={(event) => {
          pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <div className="relative shrink-0">
        <Avatar className="size-16">
          {user.avatar_url && <AvatarImage src={user.avatar_url} alt="" />}
          <AvatarFallback className="text-base font-medium">{initialsOf(name)}</AvatarFallback>
        </Avatar>
        {/* Over the photo, not around it: the button's name is the action, never the initials. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={action}
              disabled={busy}
              onClick={choose}
              className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-foreground/45 text-background opacity-0 transition-opacity outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-0"
            >
              <Camera aria-hidden className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{action}</TooltipContent>
        </Tooltip>
        {busy && (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60"
          >
            <LoaderCircle className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
          </span>
        )}
      </div>
      <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
        <span className="truncate text-title-sm font-medium text-foreground">{name}</span>
        <p className="text-body-sm text-pretty text-muted-foreground">{hint}</p>
        {error && (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={choose}>
          <ImageUp aria-hidden />
          {action}
        </Button>
        {own && (
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
        )}
      </div>
      {draft && (
        <PhotoCropDialog
          file={draft.file}
          url={draft.url}
          saving={upload.isPending}
          error={upload.error ? errorMessage(upload.error) : ''}
          onCancel={cancel}
          onSave={save}
        />
      )}
      {confirming && (
        <ConfirmDialog
          tone="destructive"
          title={translate('removeYourPhoto')}
          body={translate('yourGooglePictureShowsAgainIfYouConnectedGoogle')}
          confirmLabel={translate('removePhoto')}
          onDecide={(approved) => {
            setConfirming(false)
            if (approved)
              remove.mutate(undefined, {
                onSuccess: () => toast.success(translate('photoRemoved')),
                onError: (failure) => setError(errorMessage(failure)),
              })
          }}
        />
      )}
    </div>
  )
}

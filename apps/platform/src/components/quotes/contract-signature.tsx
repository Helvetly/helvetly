'use client'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Input } from '@helvetly/ui/components/input'
import { PHOTO_TYPES, photoProblem } from '@helvetly/ui/lib/photo'
import { cn } from '@helvetly/ui/lib/utils'
import { ImageUp, LoaderCircle, PenLine, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { lazy, Suspense, useRef, useState } from 'react'

import { errorMessage } from '@/lib/api'
import {
  signatureImageUrl,
  useContractSignature,
  useRemoveSignature,
  useSignaturePlace,
  useUploadSignature,
} from '@/lib/contract-signature'
import { translate } from '@/lib/i18n'

// The dialog loads its script fonts: only when it opens.
const AdoptDialog = lazy(() =>
  import('@/components/signatures/adopt-dialog').then((module) => ({
    default: module.AdoptDialog,
  })),
)

/**
 * Your signature for contracts: drawn, typed or uploaded, shown only to you, and the place you sign at. Written
 * contracts print it on the contractor's side with the place and the day. Used in Settings and, when it is missing,
 * in the contract's last step.
 */
export function ContractSignatureEditor({
  name,
  id = 'contract-signature',
}: {
  name: string
  id?: string
}) {
  const signature = useContractSignature()
  const upload = useUploadSignature()
  const remove = useRemoveSignature()
  const savePlace = useSignaturePlace()
  const input = useRef<HTMLInputElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [error, setError] = useState('')
  // A new upload is a new image: the URL changes so no earlier one is shown.
  const [version, setVersion] = useState(0)
  // null until edited: the stored place
  const [edited, setEdited] = useState<string | null>(null)
  const data = signature.data
  const place = edited ?? data?.place ?? ''

  const busy = upload.isPending || remove.isPending
  const store = (image: Blob) => {
    setError('')
    upload.mutate(image, {
      onSuccess: () => setVersion((at) => at + 1),
      onError: (failure) => setError(errorMessage(failure)),
    })
  }
  const pick = (file: File | undefined) => {
    if (!file) return
    const problem = photoProblem(file)
    setError(problem ?? '')
    if (!problem) store(file)
  }
  const commitPlace = () => {
    if (data && place.trim() !== data.place)
      savePlace.mutate(place.trim(), { onError: (failure) => setError(errorMessage(failure)) })
  }

  return (
    <div className="grid gap-3">
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid={`${id}-input`}
        onChange={(event) => {
          pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div
          // ink on paper: white behind an image in either theme
          className={cn(
            'flex h-20 w-60 shrink-0 items-center justify-center rounded-xl border px-3',
            data?.has_image && 'bg-white',
          )}
          aria-busy={busy}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          ) : data?.has_image ? (
            <span className="relative block h-16 w-full">
              <Image
                src={signatureImageUrl(version)}
                alt={translate('yourSignature')}
                fill
                unoptimized
                sizes="216px"
                className="object-contain"
              />
            </span>
          ) : (
            <span className="text-body-sm text-muted-foreground">
              {translate('noSignatureYet')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={() => setDrawing(true)}
          >
            <PenLine className="size-3.5" />
            {translate('drawOrTypeSignature')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <ImageUp className="size-3.5" />
            {translate('uploadImage')}
          </Button>
          {data?.has_image && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={() => remove.mutate()}
            >
              <Trash2 className="size-3.5" />
              {translate('removeSignature')}
            </Button>
          )}
        </div>
      </div>
      {error && <InlineError>{error}</InlineError>}
      <FormField
        id={`${id}-place`}
        label={translate('signingPlace')}
        tip={translate('signingPlaceTip')}
        width="md"
      >
        <Input
          id={`${id}-place`}
          value={place}
          maxLength={100}
          placeholder={data?.default_place || translate('city')}
          onChange={(event) => setEdited(event.target.value)}
          onBlur={commitPlace}
        />
      </FormField>
      {drawing && (
        <Suspense>
          <AdoptDialog
            name={name}
            purpose="save"
            onClose={() => setDrawing(false)}
            onAdopt={({ image }) => {
              setDrawing(false)
              void fetch(image)
                .then((response) => response.blob())
                .then(store)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

'use client'
import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { ImagePlus, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { useRef, useState, type DragEvent } from 'react'

import { useLogoCrop } from '@/components/shared/logo-crop'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { LOGO_TYPES, useLogo } from '@/lib/invoices'

// A transparent logo shows on a checkerboard, so its edges are visible.
const CHECKER =
  'bg-white bg-[conic-gradient(#e5e5e5_25%,transparent_0_50%,#e5e5e5_0_75%,transparent_0)] bg-[length:12px_12px]'

/** The welcome's document-logo picker: a preview square, what fits, and one button; drop works too. Picking opens the crop. */
export function LogoCard({ url }: { url: string | null }) {
  const logo = useLogo()
  const input = useRef<HTMLInputElement>(null)
  const [removeError, setError] = useState('')
  const [over, setOver] = useState(false)
  const busy = logo.progress !== null || logo.remove.isPending

  const crop = useLogoCrop({
    kind: 'document',
    send: (file, handlers) => logo.upload.mutate(file, handlers),
    progress: logo.progress,
    onSaved: () => undefined,
  })
  const error = crop.pickError || removeError
  const send = (file: File | undefined) => {
    setError('')
    crop.pick(file)
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    send(event.dataTransfer.files[0])
  }

  return (
    <div className="grid gap-2">
      {crop.dialog}
      <input
        ref={input}
        type="file"
        accept={LOGO_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          send(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <div
        data-testid="logo-drop"
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          'relative flex items-center gap-4 rounded-xl border-2 border-dashed border-border bg-card p-4 transition-colors sm:gap-5',
          over && 'border-primary bg-primary/5',
          error && 'border-destructive/60',
        )}
      >
        <span
          className={cn(
            'relative flex aspect-[5/2] w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-border sm:w-44',
            url ? CHECKER : 'bg-muted text-muted-foreground',
          )}
        >
          {url ? (
            <Image
              src={url}
              alt={translate('yourLogo')}
              fill
              unoptimized
              sizes="176px"
              className="object-contain p-1.5"
            />
          ) : (
            <ImagePlus className="size-7 stroke-[1.5]" />
          )}
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="text-sm font-medium">
            {url ? translate('yourLogo') : translate('uploadYourLogo')}
          </span>
          <span className="text-caption text-muted-foreground">
            {translate('pngOrJPEGUpTo2MBDropIt')}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {logo.progress !== null
                ? translate('uploading3')
                : url
                  ? translate('replace2')
                  : translate('chooseFile')}
            </Button>
            {url && (
              <Button
                type="button"
                variant="destructive-ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setError('')
                  logo.remove.mutate(undefined, {
                    onError: (failure) => setError(errorMessage(failure)),
                  })
                }}
              >
                <Trash2 />
                {translate('remove')}
              </Button>
            )}
          </span>
        </span>
        {logo.progress !== null && (
          <span className="absolute inset-x-4 bottom-2 h-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(logo.progress * 100)}%` }}
            />
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

'use client'
import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, ImagePlus, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'

import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { LOGO_TYPES, logoProblem, useLogo } from '@/lib/invoices'

/** Picks one image (click or drop), checks it, uploads it; `error` is what went wrong, if anything. */
function useLogoPicker() {
  const logo = useLogo()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  // The upload saves at once; this says so next to the logo for a moment.
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(null), 2500)
    return () => clearTimeout(timer)
  }, [done])
  const send = (file: File | undefined) => {
    if (!file) return
    const problem = logoProblem(file)
    setError(problem ?? '')
    if (problem) return
    setDone(null)
    logo.upload.mutate(file, {
      onSuccess: () => {
        setDone(translate('logoSaved'))
        toast.success(translate('logoSavedItShowsOnEveryNewPDF'))
      },
      onError: (failure) => setError(errorMessage(failure)),
    })
  }
  const field = (
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
  )
  return { logo, error, setError, done, setDone, send, field, open: () => input.current?.click() }
}

/** The logo in the settings: drop or click to upload, shown on white at its real proportions. */
export function LogoDropzone({ url, canEdit }: { url: string | null; canEdit: boolean }) {
  const { logo, error, setError, done, setDone, send, field, open } = useLogoPicker()
  const [over, setOver] = useState(false)
  const busy = logo.progress !== null
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    if (canEdit) send(event.dataTransfer.files[0])
  }

  return (
    <div className="grid gap-2">
      {field}
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          'relative flex items-center gap-6 rounded-xl transition-colors',
          // With a logo the card frames it already; only the empty drop target needs an outline.
          !url && 'min-h-36 border border-dashed border-border px-5 py-4',
          over && 'bg-heidi-soft/30 ring-2 ring-ring/60',
        )}
      >
        {url ? (
          <>
            {/* Logos are made for paper: always on white, as on the PDF. */}
            <span className="flex h-24 w-56 shrink-0 items-center justify-center rounded-lg bg-white p-3 shadow-elevation-1">
              <span className="relative size-full">
                <Image
                  src={url}
                  alt={translate('yourLogo')}
                  fill
                  unoptimized
                  sizes="224px"
                  className="object-contain"
                />
              </span>
            </span>
            <span className="grid gap-2">
              <span className="text-body-sm text-muted-foreground">
                {translate('dropANewImageHereToReplaceIt')}
              </span>
              {canEdit && (
                <span className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={open}>
                    {translate('replace2')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive-ghost"
                    size="sm"
                    disabled={busy || logo.remove.isPending}
                    onClick={() => {
                      setError('')
                      setDone(null)
                      logo.remove.mutate(undefined, {
                        onSuccess: () => {
                          setDone(translate('logoRemoved2'))
                          toast.success(translate('logoRemoved'))
                        },
                        onError: (failure) => setError(errorMessage(failure)),
                      })
                    }}
                  >
                    <Trash2 />
                    {translate('remove')}
                  </Button>
                </span>
              )}
            </span>
          </>
        ) : (
          <button
            type="button"
            disabled={!canEdit || busy}
            onClick={open}
            className="grid w-full justify-items-center gap-1.5 py-2 text-center text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
              <ImagePlus className="size-5 stroke-[1.5]" />
            </span>
            <span className="text-body font-medium text-foreground">
              {translate('dropYourLogoHereOrClickToChoose')}
            </span>
            <span className="text-caption">{translate('pngOrJPEGUpTo2MBAWide')}</span>
          </button>
        )}
        {busy && (
          <span
            className={cn(
              'absolute h-1 overflow-hidden rounded-full bg-muted',
              url ? 'inset-x-0 -bottom-3' : 'inset-x-5 bottom-3',
            )}
          >
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round((logo.progress ?? 0) * 100)}%` }}
            />
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <output
        aria-live="polite"
        className="flex min-h-5 items-center gap-1.5 text-body-sm font-medium text-success"
      >
        {done && (
          <>
            <Check className="size-4" aria-hidden /> {done}
          </>
        )}
      </output>
    </div>
  )
}

/** The logo on the editor's letterhead, or a quiet "Add logo" that uploads straight away. */
export function LetterheadLogo({ url, canEdit }: { url: string | null; canEdit: boolean }) {
  const { logo, error, field, open } = useLogoPicker()
  if (url)
    return (
      <span className="relative mb-4 block h-14 w-56 dark:rounded-md dark:bg-white dark:p-1.5">
        <Image
          src={url}
          alt={translate('yourLogo')}
          fill
          unoptimized
          sizes="224px"
          className="object-contain object-left"
        />
      </span>
    )
  if (!canEdit) return null
  const busy = logo.progress !== null
  return (
    <div className="mb-4 grid gap-1">
      {field}
      <button
        type="button"
        disabled={busy}
        onClick={open}
        className="flex h-14 w-40 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-body-sm text-muted-foreground/80 transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground"
      >
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        {busy ? translate('uploading3') : translate('addLogo')}
      </button>
      {error && <span className="text-caption text-destructive">{error}</span>}
    </div>
  )
}

'use client'

import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { ImagePlus, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { useRef, useState, type DragEvent } from 'react'

import { errorMessage } from '@/lib/api'
import { LOGO_TYPES, logoProblem, useLogo } from '@/lib/invoices'

// A transparent logo shows on a checkerboard, so its edges are visible.
const CHECKER =
  'bg-white bg-[conic-gradient(#e5e5e5_25%,transparent_0_50%,#e5e5e5_0_75%,transparent_0)] bg-[length:12px_12px]'

/** The welcome's logo picker: a preview square, what fits, and one button; drop works too. */
export function LogoCard({ url }: { url: string | null }) {
  const logo = useLogo()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const busy = logo.progress !== null || logo.remove.isPending

  const send = (file: File | undefined) => {
    if (!file) return
    const problem = logoProblem(file)
    setError(problem ?? '')
    if (!problem)
      logo.upload.mutate(file, { onError: (failure) => setError(errorMessage(failure)) })
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    send(event.dataTransfer.files[0])
  }

  return (
    <div className="grid gap-2">
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
            'relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-border',
            url ? CHECKER : 'bg-muted text-muted-foreground',
          )}
        >
          {url ? (
            <Image
              src={url}
              alt="Your logo"
              fill
              unoptimized
              sizes="80px"
              className="object-contain p-1.5"
            />
          ) : (
            <ImagePlus className="size-7 stroke-[1.5]" />
          )}
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="text-sm font-medium">{url ? 'Your logo' : 'Upload your logo'}</span>
          <span className="text-[13px] text-muted-foreground">
            PNG or JPEG, up to 2 MB. Drop it here or choose a file.
          </span>
          <span className="mt-1.5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {logo.progress !== null ? 'Uploading…' : url ? 'Replace' : 'Choose file'}
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
                <Trash2 /> Remove
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

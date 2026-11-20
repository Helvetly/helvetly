'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { cn } from '@helvetly/ui/lib/utils'
import type { UseMutationResult } from '@tanstack/react-query'
import { Bug, ImagePlus, Lightbulb, Lock, X } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { TextareaBox } from '@/components/textarea-box'
import { errorMessage } from '@/lib/api'
import {
  MAX_DESCRIPTION,
  MAX_SCREENSHOTS,
  SCREENSHOT_TYPES,
  screenshotError,
  type FeedbackInput,
  type FeedbackKind,
} from '@/lib/feedback'
import { translate } from '@/lib/i18n'

const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`

const KINDS = [
  {
    value: 'problem',
    label: translate('reportAProblem'),
    hint: translate('somethingIsnTWorking'),
    icon: Bug,
  },
  {
    value: 'feature',
    label: translate('suggestAnIdea'),
    hint: translate('makeHelvetlyBetter'),
    icon: Lightbulb,
  },
] as const

export type SendFeedback = UseMutationResult<{ id: string }, Error, FeedbackInput>

/** A problem report or an idea for the Helvetly team, with optional screenshots. */
export function FeedbackForm({
  send,
  initialDescription = '',
  onSent,
  onCancel,
}: {
  send: SendFeedback
  initialDescription?: string
  onSent: () => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState<FeedbackKind>('problem')
  const [description, setDescription] = useState(initialDescription)
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const fileError = screenshotError(screenshots)
  const shown = fileError || error
  const length = description.trim().length

  const add = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (!images.length) return
    // The same image twice is refused by the server, so it is not added twice.
    setScreenshots((current) => [
      ...current,
      ...images.filter((file) => !current.some((c) => fileKey(c) === fileKey(file))),
    ])
    setError('')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (send.isPending) return
    if (!length) return setError(translate('describeWhatHappenedOrWhatYouWouldLike'))
    if (length > MAX_DESCRIPTION)
      return setError(
        translate('keepTheDescriptionUnderCharacters', { MAX_DESCRIPTION: MAX_DESCRIPTION }),
      )
    if (fileError) return
    send.mutate(
      { kind, description, screenshots },
      {
        onSuccess: () => {
          setKind('problem')
          setDescription('')
          setScreenshots([])
          setError('')
          onSent()
        },
        onError: (err) => setError(errorMessage(err)),
      },
    )
  }

  return (
    <form
      ref={form}
      onSubmit={submit}
      noValidate
      aria-busy={send.isPending}
      // Screenshots can be pasted anywhere in the form.
      onPaste={(event) => add([...event.clipboardData.files])}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-6 pt-5 pb-6">
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-[13px] font-medium">
            {translate('whatWouldYouLikeToShare')}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map(({ value, label, hint, icon: Icon }) => {
              const checked = kind === value
              return (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors duration-150 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:cursor-default has-disabled:opacity-60',
                    checked
                      ? 'border-foreground/25 bg-muted/60'
                      : 'border-border hover:bg-muted/40',
                  )}
                >
                  <input
                    type="radio"
                    name="feedback-kind"
                    value={value}
                    checked={checked}
                    disabled={send.isPending}
                    onChange={() => setKind(value)}
                    className="sr-only"
                  />
                  <Icon
                    className={cn(
                      'mt-0.5 size-4 shrink-0 stroke-[1.75]',
                      checked ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium">{label}</span>
                    <span className="block text-[12px] text-muted-foreground">{hint}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="grid gap-2">
          <label htmlFor="feedback-description" className="text-[13px] font-medium">
            {translate('description')}
            <span aria-hidden className="ml-0.5 text-destructive">
              *
            </span>
          </label>
          <TextareaBox
            id="feedback-description"
            aria-required
            aria-invalid={Boolean(error) && !length}
            value={description}
            disabled={send.isPending}
            placeholder={
              kind === 'problem'
                ? translate('whatHappenedAndWhatDidYouExpectInstead')
                : translate('whatWouldYouLikeHelvetlyToDoAndWhy')
            }
            onChange={(event) => {
              setDescription(event.target.value)
              setError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                form.current?.requestSubmit()
            }}
            max={MAX_DESCRIPTION}
            className="min-h-36 resize-none text-[14px] leading-relaxed"
          />
        </div>

        <div className="grid gap-2">
          <span className="text-[13px] font-medium">{translate('screenshots2')}</span>
          <input
            ref={picker}
            id="feedback-screenshots"
            aria-label={translate('screenshots')}
            type="file"
            multiple
            accept={SCREENSHOT_TYPES.join(',')}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              add([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
          {screenshots.length < MAX_SCREENSHOTS && (
            <button
              type="button"
              disabled={send.isPending}
              onClick={() => picker.current?.click()}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                add([...event.dataTransfer.files])
              }}
              className={cn(
                'flex items-center gap-3 rounded-xl border border-dashed px-3.5 py-3 text-left transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
                dragging ? 'border-foreground/40 bg-muted/60' : 'hover:bg-muted/40',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <ImagePlus className="size-4 stroke-[1.75]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px]">
                  {translate('dropPasteOr')}
                  <span className="underline underline-offset-2">{translate('browse')}</span>
                </span>
                <span className="block text-[12px] text-muted-foreground">
                  {translate('upTo')}
                  {MAX_SCREENSHOTS}
                  {translate('pngJPEGOrWebPImages5MBEach')}
                </span>
              </span>
            </button>
          )}
          {screenshots.length > 0 && (
            <ul aria-label={translate('selectedScreenshots')} className="grid grid-cols-5 gap-2">
              {screenshots.map((file, index) => (
                <li key={fileKey(file)} className="group relative">
                  <Thumbnail file={file} />
                  <button
                    type="button"
                    aria-label={translate('removeScreenshot', {
                      value1: index + 1,
                      name: file.name,
                    })}
                    disabled={send.isPending}
                    onClick={() =>
                      setScreenshots((current) => current.filter((_, i) => i !== index))
                    }
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white opacity-90 transition-opacity outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <Lock className="mt-px size-3.5 shrink-0" />
          {translate('yourAccountWorkspaceAndThePageYouAreOn')}
        </p>

        {shown && (
          <Callout tone="danger" role="alert">
            {shown}
          </Callout>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-3.5">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={send.isPending}>
          {translate('cancel')}
        </Button>
        <Button type="submit" disabled={send.isPending}>
          {send.isPending ? translate('sending') : translate('sendFeedback')}
        </Button>
      </footer>
    </form>
  )
}

/** A square preview of a chosen screenshot; the object URL is released when it goes. */
function Thumbnail({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <div
      className="relative aspect-square overflow-hidden rounded-lg border bg-muted"
      title={file.name}
    >
      <Image src={url} alt={file.name} fill unoptimized sizes="80px" className="object-cover" />
    </div>
  )
}

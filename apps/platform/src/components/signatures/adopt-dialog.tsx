'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Combobox } from '@helvetly/ui/components/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Input } from '@helvetly/ui/components/input'
import { Label } from '@helvetly/ui/components/label'
import { segmentLabels } from '@helvetly/ui/components/segmented'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import { BadgeCheck, Eraser, ImageUp, LoaderCircle, PenLine, Type } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'

import { INK, trimmedPng, typedPng, UPLOAD_MAX_BYTES, UPLOAD_TYPES, uploadedPng } from './ink'
import { SCRIPT_FONTS } from './script-fonts'

export type Adopted = { method: 'typed' | 'drawn' | 'uploaded' | 'saved'; image: string }

const METHODS = [
  ['saved', translate('savedSignature'), BadgeCheck],
  ['typed', translate('typeSignature'), Type],
  ['drawn', translate('drawSignature'), PenLine],
  ['uploaded', translate('uploadSignature'), ImageUp],
] as const

/**
 * "Adopt your signature": the saved one, typed in a script style, drawn or an uploaded image; the result is a PNG.
 * `saved` (a PNG data URL) offers the signer's saved signature first. `purpose` "save" stores it in Settings instead
 * of signing a document.
 */
export function AdoptDialog({
  name,
  saved,
  purpose = 'sign',
  onAdopt,
  onClose,
}: {
  name: string
  saved?: string | null
  purpose?: 'sign' | 'save'
  onAdopt: (signature: Adopted) => void
  onClose: () => void
}) {
  const [method, setMethod] = useState<Adopted['method']>(saved ? 'saved' : 'typed')
  const [typed, setTyped] = useState(name)
  const [font, setFont] = useState<string>(SCRIPT_FONTS[0].id)
  const [drawn, setDrawn] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const methods = METHODS.filter(([value]) => value !== 'saved' || saved)
  const family = SCRIPT_FONTS.find((entry) => entry.id === font)?.family ?? 'cursive'
  const text = typed.trim()
  const images = { drawn, uploaded, saved: saved ?? null }

  const adopt = async () => {
    setBusy(true)
    try {
      const image = method === 'typed' ? await typedPng(text, family) : images[method]
      if (image) onAdopt({ method, image })
    } finally {
      setBusy(false)
    }
  }

  const ready = method === 'typed' ? text.length > 0 : images[method] !== null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-none! gap-5 rounded-2xl p-5 sm:p-6">
        <div className="grid gap-1">
          <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">
            {translate('adoptYourSignature')}
          </DialogTitle>
          <DialogDescription className="text-body-sm">
            {purpose === 'sign'
              ? translate('thisSignatureWillBePlacedInEverySignatureFieldOfThisDocument')
              : translate('savedInYourAccountForTheContractsYouSign')}
          </DialogDescription>
        </div>
        <div
          className={cn(segmentTrack, 'grid', methods.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}
        >
          {methods.map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={method === value}
              onClick={() => setMethod(value)}
              className={cn(segmentItem, 'h-8 px-2')}
            >
              <Icon className="size-4" />
              <span className={cn(methods.length === 4 && 'max-sm:sr-only')}>
                {segmentLabels(label)}
              </span>
            </button>
          ))}
        </div>

        {method === 'saved' && saved ? (
          <Paper>
            <SignatureImage src={saved} />
          </Paper>
        ) : method === 'typed' ? (
          <TypePanel
            text={text}
            typed={typed}
            onTyped={setTyped}
            font={font}
            family={family}
            onFont={setFont}
          />
        ) : method === 'drawn' ? (
          <DrawPad onInk={setDrawn} />
        ) : (
          <UploadPanel onImage={setUploaded} />
        )}

        {purpose === 'sign' && (
          <p className="text-xs text-muted-foreground">
            {translate('byAdoptingYouAgreeThisIsYourElectronicSignature')}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button size="xl" variant="outline" className="cursor-pointer" onClick={onClose}>
            {translate('cancel')}
          </Button>
          <Button
            size="xl"
            className="cursor-pointer"
            disabled={!ready || busy}
            onClick={() => void adopt()}
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {purpose === 'sign' ? translate('adoptAndSign') : translate('saveSignature')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The white sheet a signature is shown on (ink on paper in either theme), with the line it sits on. */
function Paper({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        '@container relative flex h-[148px] items-center justify-center overflow-hidden rounded-xl border bg-white px-6',
        className,
      )}
    >
      {children}
      <span className="pointer-events-none absolute inset-x-8 bottom-7 border-b border-dashed border-black/15" />
    </div>
  )
}

/** A signature image (a data URL) fitted into the paper. */
function SignatureImage({ src }: { src: string }) {
  return (
    <span className="relative block h-24 w-full">
      <Image
        src={src}
        alt={translate('yourSignature')}
        fill
        unoptimized
        className="object-contain"
      />
    </span>
  )
}

function TypePanel({
  text,
  typed,
  onTyped,
  font,
  family,
  onFont,
}: {
  text: string
  typed: string
  onTyped: (value: string) => void
  font: string
  family: string
  onFont: (value: string) => void
}) {
  const nameId = useId()
  const styleId = useId()
  const shown = text || translate('yourName')
  // Long names shrink with the paper's width (cqw) so the whole name stays in view, also on phones.
  const size = `min(48px, ${(150 / Math.max(10, shown.length)).toFixed(2)}cqw)`
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={nameId}>{translate('yourName')}</Label>
          <Input
            id={nameId}
            value={typed}
            maxLength={80}
            autoComplete="name"
            onChange={(event) => onTyped(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={styleId}>{translate('signatureStyle')}</Label>
          <Combobox
            id={styleId}
            value={font}
            onChange={onFont}
            placeholder={translate('signatureStyle')}
            options={SCRIPT_FONTS.map((entry) => ({ value: entry.id, label: entry.label }))}
            renderOption={(option) => (
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span
                  className="min-w-0 truncate text-[22px] leading-8"
                  style={{
                    fontFamily: SCRIPT_FONTS.find((entry) => entry.id === option.value)?.family,
                    color: INK,
                  }}
                >
                  {shown}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{option.label}</span>
              </span>
            )}
          />
        </div>
      </div>
      <Paper>
        <span
          aria-live="polite"
          className="max-w-full truncate leading-[1.4]"
          style={{ fontFamily: family, color: INK, fontSize: size }}
        >
          {shown}
        </span>
      </Paper>
    </div>
  )
}

/** Where the pointer is on the canvas, in canvas pixels. */
function point(event: PointerEvent<HTMLCanvasElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  const ratio = event.currentTarget.width / rect.width
  return { x: (event.clientX - rect.left) * ratio, y: (event.clientY - rect.top) * ratio, ratio }
}

/** A white pad to draw on with a mouse, pen or finger; reports the trimmed PNG after each stroke. */
function DrawPad({ onInk }: { onInk: (image: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const ratio = window.devicePixelRatio || 1
    element.width = element.clientWidth * ratio
    element.height = element.clientHeight * ratio
  }, [])

  const stroke = (event: PointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext('2d')
    const from = last.current
    if (!context || !from) return
    const to = point(event)
    const pressure = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure * 1.6 : 1
    context.strokeStyle = INK
    context.lineWidth = 2.6 * to.ratio * pressure
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
    last.current = to
  }

  return (
    <div className="grid gap-2">
      <div className="relative">
        <canvas
          ref={canvas}
          aria-label={translate('drawYourSignature')}
          className="h-[180px] w-full cursor-crosshair touch-none rounded-xl border bg-white"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            last.current = point(event)
          }}
          onPointerMove={stroke}
          onPointerUp={(event) => {
            last.current = null
            onInk(trimmedPng(event.currentTarget))
          }}
        />
        <span className="pointer-events-none absolute inset-x-8 bottom-10 border-b border-dashed border-black/15" />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{translate('signAboveTheLine')}</span>
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer gap-1 px-2"
          onClick={() => {
            const element = canvas.current
            element?.getContext('2d')?.clearRect(0, 0, element.width, element.height)
            onInk(null)
          }}
        >
          <Eraser className="size-3.5" />
          {translate('clear2')}
        </Button>
      </div>
    </div>
  )
}

/** What is wrong with a picked file before it is read, or null. */
export const uploadProblem = (file: File) =>
  !UPLOAD_TYPES.includes(file.type)
    ? translate('uploadYourSignatureAsAPNGJPGOrWebPImage')
    : file.size > UPLOAD_MAX_BYTES
      ? translate('theImageIsLargerThan5MB')
      : null

/** Drop or pick an image of a signature; shows it cropped, optionally without its white paper. */
function UploadPanel({ onImage }: { onImage: (image: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const transparentId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [transparent, setTransparent] = useState(true)
  const [image, setImage] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  // Only the latest read counts: a slower earlier one must not replace it.
  const latest = useRef(0)
  const read = async (next: File, clear: boolean) => {
    const at = ++latest.current
    setReading(true)
    const png = await uploadedPng(next, clear)
    if (at !== latest.current) return
    setReading(false)
    setImage(png)
    setProblem(png ? null : translate('noSignatureFoundInThisImage'))
    onImage(png)
  }

  const pick = (picked: File | undefined) => {
    if (!picked) return
    const wrong = uploadProblem(picked)
    setProblem(wrong)
    if (wrong) return
    setFile(picked)
    void read(picked, transparent)
  }

  const choose = () => input.current?.click()
  return (
    <div className="grid gap-2">
      <input
        ref={input}
        type="file"
        accept={UPLOAD_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="signature-upload-input"
        onChange={(event) => {
          pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {file && (image || reading) ? (
        <>
          <Paper>
            {reading || !image ? (
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <SignatureImage src={image} />
            )}
          </Paper>
          <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
            <div className="flex items-center gap-2">
              <Checkbox
                id={transparentId}
                checked={transparent}
                onCheckedChange={(checked) => {
                  setTransparent(checked === true)
                  if (file) void read(file, checked === true)
                }}
              />
              <Label htmlFor={transparentId} className="cursor-pointer font-normal">
                {translate('removeTheWhiteBackground')}
              </Label>
            </div>
            <button
              type="button"
              className="cursor-pointer text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={choose}
            >
              {translate('chooseAnotherImage')}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={choose}
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setOver(false)
            pick(event.dataTransfer.files[0])
          }}
          className={cn(
            'flex h-[180px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/40 px-6 text-center transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50',
            over && 'border-brand-solid bg-brand-solid/5',
          )}
        >
          <ImageUp className="size-6 text-muted-foreground" />
          <span className="text-body-sm">
            {translate('dropAnImageHereOr')}{' '}
            <span className="underline underline-offset-2">{translate('chooseAFile')}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {translate('pngJpgOrWebPUpTo5MBSignOnWhitePaper')}
          </span>
        </button>
      )}
      {problem && <InlineError>{problem}</InlineError>}
    </div>
  )
}

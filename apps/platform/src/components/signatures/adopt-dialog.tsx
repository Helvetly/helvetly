'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { Input } from '@helvetly/ui/components/input'
import { Eraser, PenLine, Type } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

import { translate } from '@/lib/i18n'

import { INK, trimmedPng, typedPng } from './ink'
import { SCRIPT_FONTS } from './script-fonts'

export type Adopted = { method: 'typed' | 'drawn'; image: string }

const METHODS = [
  ['typed', translate('type'), Type],
  ['drawn', translate('draw'), PenLine],
] as const

/** "Adopt your signature": type it in a script style or draw it; the result is a PNG. */
export function AdoptDialog({
  name,
  onAdopt,
  onClose,
}: {
  name: string
  onAdopt: (signature: Adopted) => void
  onClose: () => void
}) {
  const [method, setMethod] = useState<Adopted['method']>('typed')
  const [typed, setTyped] = useState(name)
  const [font, setFont] = useState<string>(SCRIPT_FONTS[0]?.id ?? '')
  const [drawn, setDrawn] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const adopt = async () => {
    setBusy(true)
    try {
      const family = SCRIPT_FONTS.find((entry) => entry.id === font)?.family ?? 'cursive'
      const image = method === 'typed' ? await typedPng(typed.trim(), family) : drawn
      if (image) onAdopt({ method, image })
    } finally {
      setBusy(false)
    }
  }

  const ready = method === 'typed' ? typed.trim().length > 0 : drawn !== null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-none! gap-5 rounded-2xl p-6">
        <div className="grid gap-1">
          <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">
            {translate('adoptYourSignature')}
          </DialogTitle>
          <DialogDescription className="text-[13.5px]">
            {translate('itGoesIntoEverySignatureFieldOfThisDocument')}
          </DialogDescription>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
          {METHODS.map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={method === value}
              onClick={() => setMethod(value)}
              className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg text-[13.5px] text-muted-foreground transition-colors aria-pressed:bg-card aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:shadow-elevation-1"
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        {method === 'typed' ? (
          <div className="grid gap-3">
            <Input
              aria-label={translate('yourName')}
              value={typed}
              maxLength={80}
              onChange={(event) => setTyped(event.target.value)}
            />
            <div className="grid gap-2">
              {SCRIPT_FONTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={font === entry.id}
                  aria-label={translate('style', {
                    value1: typed.trim() || translate('yourName'),
                    label: entry.label,
                  })}
                  onClick={() => setFont(entry.id)}
                  className="flex h-[72px] cursor-pointer items-center overflow-hidden rounded-xl border bg-white px-5 text-left text-[34px] whitespace-nowrap transition-colors aria-pressed:border-brand-solid aria-pressed:ring-2 aria-pressed:ring-brand-solid/25"
                  style={{ fontFamily: entry.family, color: INK }}
                >
                  {typed.trim() || translate('yourName')}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <DrawPad onInk={setDrawn} />
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="xl" variant="outline" className="cursor-pointer" onClick={onClose}>
            {translate('cancel')}
          </Button>
          <Button
            size="xl"
            className="cursor-pointer"
            disabled={!ready || busy}
            onClick={() => void adopt()}
          >
            {translate('adoptAndSign')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
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

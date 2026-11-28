'use client'
import { cn } from '@helvetly/ui/lib/utils'
import Image from 'next/image'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { translate } from '@/lib/i18n'
import {
  clampView,
  DOCUMENT_LOGO_BOX_MM,
  documentPrintSize,
  documentRatio,
  placeOnCanvas,
  type DocumentView,
} from '@/lib/logo-crop'

const KEY_STEP = 0.02
const ZOOM_KEY_STEP = 0.1
// The PDFs' A4 page and the left and top margins the logo is drawn at (apps/api/internal/invoicepdf).
const PAGE_MM = 210
const MARGIN_MM = { left: 20, top: 15 }
/** A length on the page as a share of the paper's width. */
const mm = (value: number) => `${(value / PAGE_MM) * 100}%`

/** A transparent logo shows on a checkerboard, so its edges and any transparent padding are visible. */
export const CHECKER =
  'bg-white bg-[conic-gradient(#e5e5e5_25%,transparent_0_50%,#e5e5e5_0_75%,transparent_0)] bg-[length:12px_12px]'

/** The width : height of the PDFs' widest logo box: the shape a saved logo's thumbnail is shown in. */
export const LOGO_BOX_ASPECT = DOCUMENT_LOGO_BOX_MM.width / DOCUMENT_LOGO_BOX_MM.height

type Size = { width: number; height: number }

/** The picture placed in a field of `ratio` as `natural` and `view` say: the same maths as the saved file. */
function PlacedPicture({
  url,
  natural,
  view,
  onDecoded,
  onError,
}: {
  url: string
  natural: Size
  view: DocumentView
  onDecoded?: (size: Size) => void
  onError?: () => void
}) {
  const ratio = documentRatio(natural)
  const at = placeOnCanvas(natural, view, { width: ratio, height: 1 })
  return (
    <span
      className="pointer-events-none"
      // Position inline with the rest of the placement: next/image's fill check reads it from the style.
      style={{
        position: 'absolute',
        left: `${(at.x / ratio) * 100}%`,
        top: `${at.y * 100}%`,
        width: `${(at.width / ratio) * 100}%`,
        height: `${at.height * 100}%`,
      }}
    >
      {/* The object URL is local, so nothing to optimise. */}
      <Image
        src={url}
        alt=""
        fill
        unoptimized
        sizes="40rem"
        draggable={false}
        onLoad={(event) => {
          const { naturalWidth: width, naturalHeight: height } = event.currentTarget
          if (width && height) onDecoded?.({ width, height })
        }}
        onError={onError}
        className="object-fill"
      />
    </span>
  )
}

/**
 * The document logo's field as the PDF prints it, framed like the workspace cropper: the field (the picture's own
 * shape, 1 : 1 to 5 : 1) sits in a stage, the picture outside it dimmed, transparency on a checkerboard and a
 * rule-of-thirds grid while dragging. Drag or the arrow keys move it, `+` and `-` zoom, and it uses the same placement
 * as the saved file, so what shows is what is printed.
 */
export function DocumentLogoFrame({
  url,
  natural,
  view,
  disabled,
  onChange,
  onDecoded,
  onError,
}: {
  url: string
  natural: Size
  view: DocumentView
  disabled?: boolean
  onChange: (view: DocumentView) => void
  /** The picture's own size once decoded, with any EXIF turn applied (a JPEG's header size does not have it). */
  onDecoded: (size: Size) => void
  onError: () => void
}) {
  const frame = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ x: number; y: number; view: DocumentView } | null>(null)
  const [dragging, setDragging] = useState(false)
  const ratio = documentRatio(natural)

  const move = (dx: number, dy: number, from: DocumentView) =>
    onChange(clampView(natural, { ...from, x: from.x + dx, y: from.y + dy }))
  const press = (event: PointerEvent) => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, view }
    setDragging(true)
  }
  const track = (event: PointerEvent) => {
    const start = drag.current
    const box = frame.current?.getBoundingClientRect()
    if (!start || !box?.width) return
    move((event.clientX - start.x) / box.width, (event.clientY - start.y) / box.height, start.view)
  }
  const release = () => {
    drag.current = null
    setDragging(false)
  }
  const key = (event: KeyboardEvent) => {
    const step = event.shiftKey ? KEY_STEP * 5 : KEY_STEP
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const arrow = arrows[event.key]
    if (arrow) move(arrow[0], arrow[1], view)
    else if (event.key === '+' || event.key === '=')
      onChange(clampView(natural, { ...view, zoom: view.zoom + ZOOM_KEY_STEP }))
    else if (event.key === '-')
      onChange(clampView(natural, { ...view, zoom: view.zoom - ZOOM_KEY_STEP }))
    else return
    event.preventDefault()
  }

  return (
    // The whole stage can be dragged, as in the workspace cropper; the field is the keyboard's target.
    <div
      onPointerDown={press}
      onPointerMove={track}
      onPointerUp={release}
      onPointerCancel={release}
      className={cn(
        'relative flex h-60 touch-none items-center justify-center overflow-hidden rounded-lg bg-muted select-none',
        disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
      )}
    >
      <button
        ref={frame}
        type="button"
        disabled={disabled}
        aria-label={translate('cropAreaDragOrUseTheArrowKeysTo')}
        onKeyDown={key}
        // Fits the stage with room around it, so the dimmed picture beyond the field stays in view.
        style={{ aspectRatio: ratio, width: `min(calc(100% - 3rem), ${12 * ratio}rem)` }}
        className={cn('relative outline-none disabled:opacity-100', CHECKER)}
      >
        <PlacedPicture
          url={url}
          natural={natural}
          view={view}
          onDecoded={onDecoded}
          onError={onError}
        />
        {/* The picture outside the field is dimmed, as the workspace cropper does; the frame itself stays clear. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 border border-white/80 shadow-[0_0_0_100vmax_rgb(0_0_0/0.45)] in-focus-visible:ring-3 in-focus-visible:ring-ring/60"
        >
          {dragging && (
            <>
              <span className="absolute inset-y-0 left-1/3 w-px bg-white/70 shadow-[0_0_0_0.5px_rgb(0_0_0/0.2)]" />
              <span className="absolute inset-y-0 left-2/3 w-px bg-white/70 shadow-[0_0_0_0.5px_rgb(0_0_0/0.2)]" />
              <span className="absolute inset-x-0 top-1/3 h-px bg-white/70 shadow-[0_0_0_0.5px_rgb(0_0_0/0.2)]" />
              <span className="absolute inset-x-0 top-2/3 h-px bg-white/70 shadow-[0_0_0_0.5px_rgb(0_0_0/0.2)]" />
            </>
          )}
        </span>
      </button>
    </div>
  )
}

/**
 * The top of an invoice at its real proportions: the logo top left at the size the PDF prints it, within the dashed
 * 75 × 18 mm logo area, beside placeholder lines for the title and the seller's details. Paper is always white.
 */
export function DocumentLogoPreview({
  url,
  natural,
  view,
}: {
  url: string
  natural: Size
  view: DocumentView
}) {
  const ratio = documentRatio(natural)
  const printed = documentPrintSize(ratio)
  const line = 'block h-[3px] rounded-full bg-neutral-200'
  return (
    <figure className="grid gap-2">
      <div
        aria-hidden
        className="relative aspect-[210/60] overflow-hidden rounded-md bg-white ring-1 ring-border"
      >
        <span
          className="absolute rounded-[2px] border border-dashed border-neutral-300"
          style={{
            left: mm(MARGIN_MM.left),
            top: mm(MARGIN_MM.top),
            width: mm(DOCUMENT_LOGO_BOX_MM.width),
            aspectRatio: LOGO_BOX_ASPECT,
          }}
        />
        <span
          data-testid="printed-logo"
          className="absolute overflow-hidden"
          style={{
            left: mm(MARGIN_MM.left),
            top: mm(MARGIN_MM.top),
            width: mm(printed.width),
            aspectRatio: ratio,
          }}
        >
          <PlacedPicture url={url} natural={natural} view={view} />
        </span>
        <span className="absolute top-[7%] right-[9.5%] grid w-[26%] justify-items-end gap-[5px]">
          <span className={cn(line, 'w-full bg-neutral-300')} />
          <span className={cn(line, 'w-4/5')} />
          <span className={cn(line, 'w-3/5')} />
          <span className={cn(line, 'w-2/3')} />
        </span>
        <span className="absolute right-[9.5%] bottom-[16%] left-[9.5%] grid gap-[5px]">
          <span className="block h-[5px] w-1/4 rounded-full bg-neutral-400" />
          <span className={cn(line, 'w-full')} />
          <span className={cn(line, 'w-11/12')} />
        </span>
      </div>
      <figcaption className="text-body-sm text-muted-foreground">
        {translate('logoOnInvoicePreview', {
          width: Math.round(printed.width),
          height: Math.round(printed.height),
        })}
      </figcaption>
    </figure>
  )
}

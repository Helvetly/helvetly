'use client'
import { cn } from '@helvetly/ui/lib/utils'
import Image from 'next/image'
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

import { translate } from '@/lib/i18n'
import { clampView, DOCUMENT_LOGO_RATIO, placeOnCanvas, type DocumentView } from '@/lib/logo-crop'

const KEY_STEP = 0.02
const ZOOM_KEY_STEP = 0.1

/**
 * The document logo's field as the PDF prints it: 2.5 : 1 on white, the picture contained in it. Drag or the arrow keys
 * move it, `+` and `-` zoom, and it uses the same placement as the saved file, so what shows is what is printed.
 */
export function DocumentLogoFrame({
  url,
  natural,
  view,
  disabled,
  onChange,
  onError,
}: {
  url: string
  natural: { width: number; height: number }
  view: DocumentView
  disabled?: boolean
  onChange: (view: DocumentView) => void
  onError: () => void
}) {
  const frame = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ x: number; y: number; view: DocumentView } | null>(null)
  const at = placeOnCanvas(natural, view, { width: DOCUMENT_LOGO_RATIO, height: 1 })

  const move = (dx: number, dy: number, from: DocumentView) =>
    onChange(clampView(natural, { ...from, x: from.x + dx, y: from.y + dy }))
  const press = (event: PointerEvent) => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, view }
  }
  const track = (event: PointerEvent) => {
    const start = drag.current
    const box = frame.current?.getBoundingClientRect()
    if (!start || !box?.width) return
    move((event.clientX - start.x) / box.width, (event.clientY - start.y) / box.height, start.view)
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
    <button
      ref={frame}
      type="button"
      disabled={disabled}
      aria-label={translate('cropAreaDragOrUseTheArrowKeysTo')}
      onPointerDown={press}
      onPointerMove={track}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={key}
      className={cn(
        'relative aspect-[5/2] w-full touch-none overflow-hidden rounded-lg bg-white shadow-elevation-1 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-100',
        disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
      )}
    >
      {/* The box is placed by the same maths as the export; the object URL is local, so nothing to optimise. */}
      <span
        className="pointer-events-none absolute"
        style={{
          left: `${(at.x / DOCUMENT_LOGO_RATIO) * 100}%`,
          top: `${at.y * 100}%`,
          width: `${(at.width / DOCUMENT_LOGO_RATIO) * 100}%`,
          height: `${at.height * 100}%`,
        }}
      >
        <Image
          src={url}
          alt=""
          fill
          unoptimized
          sizes="40rem"
          draggable={false}
          onError={onError}
          className="object-fill"
        />
      </span>
    </button>
  )
}

'use client'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import { Input } from '@helvetly/ui/components/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Trash2, X, type LucideIcon } from 'lucide-react'
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'

import { PdfView } from '@/components/invoices/pdf-view'
import { translate } from '@/lib/i18n'
import {
  addField,
  clampBox,
  deleteField,
  moveField,
  signerColor,
  snapBox,
  updateField,
  type DraftField,
  type Guides,
} from '@/lib/signatures'

import { FieldBox } from './parts'

const DRAG_TYPE = 'application/x-helvetly-field'
/** How close (in screen pixels) an edge comes to a guide before Shift snaps it there. */
const SNAP_PX = 6

type Gesture<K extends string> = {
  key: string
  mode: 'move' | 'resize'
  start: DraftField<K>
  x: number
  y: number
  rect: DOMRect
}

/** What a placement screen offers: who the fields belong to and which kinds each one gets. */
export type Palette<K extends string> = {
  /** Signers (or, in a template, "Client data" and the signing roles), by index; `id` is the row's. */
  lanes: { id: string; name: string }[]
  kinds: (lane: number) => readonly K[]
  label: (kind: K) => string
  icon: (kind: K) => LucideIcon
  /** The question a field of this kind asks ("What to enter"), or null when it asks none. */
  prompt?: (kind: K) => string | null
  /** The rail's hint under the kinds. */
  hint: string
}

/**
 * A PDF with a rail to pick a lane and drag (or click, then click a page) fields onto it. Fields
 * move by dragging, resize from their corner, and go with Backspace or the bin.
 */
export function Placement<K extends string>({
  src,
  title,
  palette,
  fields,
  onFields,
  active,
  onActive,
  onPages,
  renderSettings,
}: {
  src: string
  title: string
  palette: Palette<K>
  fields: DraftField<K>[]
  onFields: (fields: DraftField<K>[]) => void
  active: number
  onActive: (index: number) => void
  onPages: (count: number) => void
  /** More settings of the selected field, by its key (a template's print size), or nothing. */
  renderSettings?: (key: string) => ReactNode
}) {
  const { lanes, kinds, label, icon, prompt } = palette
  const [selected, setSelected] = useState<string | null>(null)
  const [armed, setArmed] = useState<K | null>(null)
  const [guides, setGuides] = useState<(Guides & { page: number }) | null>(null)
  const gesture = useRef<Gesture<K> | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  const current = fields.find((field) => field.key === selected)
  // The latest list and setter, for an undo that runs after later edits.
  const latest = useRef({ fields, onFields })
  useEffect(() => {
    latest.current = { fields, onFields }
  })
  const laneName = (index: number) =>
    lanes[index]?.name || translate('signer', { value1: index + 1 })
  const caption = (field: DraftField<K>) =>
    prompt?.(field.kind) && field.label ? field.label : label(field.kind)

  const place = (kind: K, page: number, rect: DOMRect, clientX: number, clientY: number) => {
    const next = addField(
      fields,
      kind,
      active,
      page,
      (clientX - rect.left) / rect.width,
      (clientY - rect.top) / rect.height,
    )
    onFields(next)
    setSelected(next.at(-1)?.key ?? null)
    setArmed(null)
  }

  const startGesture = (event: PointerEvent, field: DraftField<K>, mode: 'move' | 'resize') => {
    event.stopPropagation()
    const page = event.currentTarget.closest('[data-page-overlay]')
    if (!page) return
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      key: field.key,
      mode,
      start: field,
      x: event.clientX,
      y: event.clientY,
      rect: page.getBoundingClientRect(),
    }
    setSelected(field.key)
    onActive(field.signer)
  }
  const continueGesture = (event: PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dx = (event.clientX - g.x) / g.rect.width
    const dy = (event.clientY - g.y) / g.rect.height
    let box =
      g.mode === 'move'
        ? clampBox({ ...g.start, x: g.start.x + dx, y: g.start.y + dy })
        : clampBox({ ...g.start, w: g.start.w + dx, h: g.start.h + dy })
    // Shift lines the box up with the other fields on its page and the page's centre.
    if (event.shiftKey) {
      const snap = snapBox(
        box,
        fields.filter((field) => field.key !== g.key),
        g.mode,
        { x: SNAP_PX / g.rect.width, y: SNAP_PX / g.rect.height },
      )
      box = clampBox(snap.box)
      setGuides({ page: box.page, ...snap.guides })
    } else setGuides(null)
    onFields(updateField(fields, g.key, { x: box.x, y: box.y, w: box.w, h: box.h }))
  }
  const endGesture = () => {
    gesture.current = null
    setGuides(null)
  }

  const overlay = (page: number) => (
    <div
      data-page-overlay
      className={cn('@container absolute inset-0', armed && 'cursor-crosshair')}
      onPointerDown={(event) => {
        if (armed)
          place(
            armed,
            page,
            event.currentTarget.getBoundingClientRect(),
            event.clientX,
            event.clientY,
          )
        else setSelected(null)
      }}
      onDragOver={(event: DragEvent) => {
        if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault()
      }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        const kind = kinds(active).find((k) => k === event.dataTransfer.getData(DRAG_TYPE))
        if (!kind) return
        event.preventDefault()
        place(kind, page, event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)
      }}
    >
      {fields
        .filter((field) => field.page === page)
        .map((field) => {
          const Icon = icon(field.kind)
          const color = signerColor(field.signer)
          return (
            <FieldBox
              key={field.key}
              data-field-key={field.key}
              box={field}
              kind={field.kind}
              color={color}
              selected={field.key === selected}
              muted={field.signer !== active && field.key !== selected}
              className="cursor-move touch-none select-none"
              onPointerDown={(event) => startGesture(event, field, 'move')}
              onPointerMove={continueGesture}
              onPointerUp={endGesture}
            >
              {/* Focus target for the keyboard: arrows move it, Backspace removes it. */}
              <button
                type="button"
                aria-label={translate('for3', {
                  value1: label(field.kind),
                  value2: laneName(field.signer),
                })}
                onFocus={() => setSelected(field.key)}
                className="flex size-full min-w-0 cursor-move items-center gap-1 px-1.5 outline-none"
              >
                <Icon className="size-[1.1em] shrink-0" />
                <span className="truncate font-medium">{caption(field)}</span>
              </button>
              <span
                aria-hidden
                className="absolute right-0 bottom-0 size-2.5 cursor-nwse-resize rounded-tl-[3px]"
                style={{ backgroundColor: color }}
                onPointerDown={(event) => startGesture(event, field, 'resize')}
                onPointerMove={continueGesture}
                onPointerUp={endGesture}
              />
            </FieldBox>
          )
        })}
      {guides?.page === page && guides.x !== null && (
        <span
          data-snap-guide="x"
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-primary/70"
          style={{ left: `${guides.x * 100}%` }}
        />
      )}
      {guides?.page === page && guides.y !== null && (
        <span
          data-snap-guide="y"
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-px bg-primary/70"
          style={{ top: `${guides.y * 100}%` }}
        />
      )}
    </div>
  )

  // Select a placed field from the list and bring it into view (its page, if still drawing).
  const reveal = (field: DraftField<K>) => {
    setSelected(field.key)
    onActive(field.signer)
    setArmed(null)
    const target =
      pane.current?.querySelector(`[data-field-key="${field.key}"]`) ??
      pane.current?.querySelector(`[data-pdf-page="${field.page}"]`)
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }
  // Removed at once, with an Undo that puts the field back.
  const remove = (key: string) => {
    const removed = fields.find((field) => field.key === key)
    if (!removed) return
    onFields(deleteField(fields, key))
    if (selected === key) setSelected(null)
    toast(translate('fieldRemoved'), {
      action: {
        label: translate('undo'),
        onClick: () => latest.current.onFields([...latest.current.fields, removed]),
      },
    })
  }
  // Backspace deletes the selected field, arrows nudge it (Shift: further), Escape lets go.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]'))
        return
      if (event.key === 'Escape') {
        setArmed(null)
        setSelected(null)
      }
      if (!selected) return
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        remove(selected)
        return
      }
      // 1 px a press, 10 with Shift, measured on the page as shown.
      const page = pane.current
        ?.querySelector(`[data-field-key="${selected}"]`)
        ?.closest('[data-page-overlay]')
        ?.getBoundingClientRect()
      const px = event.shiftKey ? 10 : 1
      const stepX = page ? px / page.width : px * 0.002
      const stepY = page ? px / page.height : px * 0.002
      const delta = {
        ArrowLeft: [-stepX, 0],
        ArrowRight: [stepX, 0],
        ArrowUp: [0, -stepY],
        ArrowDown: [0, stepY],
      }[event.key]
      if (delta) {
        event.preventDefault()
        onFields(moveField(fields, selected, delta[0] ?? 0, delta[1] ?? 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const used = lanes
    .map((lane, index) => ({
      index,
      name: lane.name || laneName(index),
      items: fields.filter((field) => field.signer === index).toSorted((a, b) => a.page - b.page),
    }))
    .filter((group) => group.items.length > 0)

  const question = current && prompt?.(current.kind)
  // The selected field's mark: the same icon as in the lists, in its signer's colour.
  const currentMark =
    current &&
    createElement(icon(current.kind), {
      'aria-hidden': true,
      className: 'size-4 shrink-0 stroke-[1.75]',
      style: { color: signerColor(current.signer) },
    })
  // A field can move only to a lane that offers its kind (client data stays client data).
  const movableTo = current
    ? lanes.map((_, index) => index).filter((index) => kinds(index).includes(current.kind))
    : []

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label={translate('fieldPalette')}
        className="flex w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-r p-4"
      >
        <section className="grid gap-1.5">
          <h3 className="text-[13px] font-medium">{translate('fieldsFor')}</h3>
          {lanes.map((lane, index) => {
            const count = fields.filter((field) => field.signer === index).length
            return (
              <button
                key={lane.id}
                type="button"
                aria-pressed={index === active}
                onClick={() => {
                  onActive(index)
                  setArmed(null)
                }}
                className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] leading-5 transition-colors hover:bg-foreground/[0.045] aria-pressed:bg-foreground/[0.06] aria-pressed:font-medium"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: signerColor(index) }}
                />
                <span title={lane.name || laneName(index)} className="min-w-0 flex-1 truncate">
                  {lane.name || laneName(index)}
                </span>
                <span className="text-[12px] text-muted-foreground tabular-nums">{count}</span>
              </button>
            )
          })}
        </section>

        <section className="grid gap-1.5">
          <h3 className="text-[13px] font-medium">{translate('dragOntoThePage')}</h3>
          {kinds(active).map((kind) => {
            const Icon = icon(kind)
            const color = signerColor(active)
            return (
              <button
                key={kind}
                type="button"
                draggable
                aria-pressed={armed === kind}
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_TYPE, kind)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => setArmed(armed === kind ? null : kind)}
                className="flex h-10 cursor-grab items-center gap-2.5 rounded-lg border border-dashed bg-card px-2.5 text-left text-[13.5px] leading-5 transition-colors hover:bg-foreground/[0.03] active:cursor-grabbing aria-pressed:border-solid"
                style={{
                  borderColor: `${color}66`,
                  ...(armed === kind && { borderColor: color, backgroundColor: `${color}12` }),
                }}
              >
                <Icon className="size-4 shrink-0 stroke-[1.75]" style={{ color }} />
                <span className="flex-1">{label(kind)}</span>
              </button>
            )
          })}
          <p className="px-1 text-[12px] leading-snug text-muted-foreground">
            {armed
              ? translate('clickOnAPageToPlaceEscCancels', { value1: label(armed) })
              : palette.hint}
          </p>
        </section>
      </aside>
      <div ref={pane} className="relative min-w-0 flex-1">
        <PdfView
          src={src}
          title={title}
          className="absolute inset-0"
          onPages={onPages}
          overlay={overlay}
        />
      </div>
      {/* What is placed and the selected field sit on the right, so the left rail stays the palette. */}
      <aside
        aria-label={translate('placedFields')}
        className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto border-l p-4"
      >
        <section aria-labelledby="placed-heading" className="grid gap-1.5">
          <div className="flex items-center">
            <h3 id="placed-heading" className="flex-1 text-[13px] font-medium">
              {translate('inThisDocument')}
            </h3>
            <span className="text-[12px] text-muted-foreground tabular-nums">{fields.length}</span>
          </div>
          {used.length === 0 && (
            <p className="px-1 text-[12px] leading-snug text-muted-foreground">
              {translate('dragFieldsOntoThePageTheyWillBeListed')}
            </p>
          )}
          {used.map((group) => (
            <div key={group.index} className="grid gap-0.5">
              <p className="flex items-center gap-2 px-1 pt-1 text-[12px] text-muted-foreground">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: signerColor(group.index) }}
                />
                <span title={group.name} className="min-w-0 flex-1 truncate">
                  {group.name}
                </span>
                <span className="tabular-nums">{group.items.length}</span>
              </p>
              <ul aria-label={group.name} className="grid gap-0.5">
                {group.items.map((field) => {
                  const Icon = icon(field.kind)
                  return (
                    <li key={field.key} className="group/item relative">
                      <button
                        type="button"
                        aria-current={field.key === selected ? 'true' : undefined}
                        title={caption(field)}
                        onClick={() => reveal(field)}
                        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg pr-9 pl-2.5 text-left text-[13px] transition-colors hover:bg-foreground/[0.045] aria-[current=true]:bg-foreground/[0.06] aria-[current=true]:font-medium"
                      >
                        <Icon
                          className="size-4 shrink-0 stroke-[1.75]"
                          style={{ color: signerColor(field.signer) }}
                        />
                        <span className="min-w-0 flex-1 truncate">{caption(field)}</span>
                        <span className="text-[12px] text-muted-foreground tabular-nums group-focus-within/item:invisible group-hover/item:invisible">
                          {translate('p2')}
                          {field.page}
                        </span>
                      </button>
                      <Button
                        variant="destructive-ghost"
                        size="icon-sm"
                        aria-label={translate('removePage', {
                          value1: caption(field),
                          page: field.page,
                        })}
                        className="absolute top-0.5 right-0.5 cursor-pointer opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 focus-visible:opacity-100"
                        onClick={() => remove(field.key)}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>

        {current && (
          <section
            aria-label={translate('fieldSettings')}
            className="grid gap-3 rounded-xl border bg-card p-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              {currentMark}
              <p
                title={caption(current)}
                className="min-w-0 flex-1 truncate text-body-sm font-medium"
              >
                {caption(current)}
              </p>
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-caption text-muted-foreground tabular-nums">
                {translate('p2')}
                {current.page}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={translate('deselect')}
                    className="cursor-pointer text-muted-foreground"
                    onClick={() => setSelected(null)}
                  >
                    <X />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translate('deselect')}</TooltipContent>
              </Tooltip>
            </div>
            {question && (
              <div className="grid gap-1">
                <label htmlFor="field-question" className="text-caption text-muted-foreground">
                  {question}
                </label>
                <Input
                  id="field-question"
                  value={current.label ?? ''}
                  maxLength={100}
                  placeholder={translate('eGJobTitle')}
                  onChange={(event) =>
                    onFields(updateField(fields, current.key, { label: event.target.value }))
                  }
                />
              </div>
            )}
            {movableTo.length > 1 && (
              <div className="grid gap-1">
                <span className="text-caption text-muted-foreground">{translate('signer2')}</span>
                <Combobox
                  label={translate('signer2')}
                  value={String(current.signer)}
                  options={movableTo.map((index) => ({
                    value: String(index),
                    label: laneName(index),
                  }))}
                  placeholder={translate('signer2')}
                  onChange={(value) => {
                    onFields(updateField(fields, current.key, { signer: Number(value) }))
                    onActive(Number(value))
                  }}
                />
              </div>
            )}
            {renderSettings?.(current.key)}
            <div className="border-t pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full cursor-pointer justify-start gap-1.5 px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => remove(current.key)}
              >
                <Trash2 className="size-4" />
                {translate('removeField').trim()}
              </Button>
            </div>
          </section>
        )}
      </aside>
    </div>
  )
}

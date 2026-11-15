'use client'
import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { Trash2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'

import { NativeSelect } from '@/components/clients/fields'
import { PdfView } from '@/components/invoices/pdf-view'
import { translate } from '@/lib/i18n'
import {
  addField,
  clampBox,
  deleteField,
  moveField,
  signerColor,
  updateField,
  type DraftField,
} from '@/lib/signatures'

import { FieldBox } from './parts'

const DRAG_TYPE = 'application/x-helvetly-field'

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
}: {
  src: string
  title: string
  palette: Palette<K>
  fields: DraftField<K>[]
  onFields: (fields: DraftField<K>[]) => void
  active: number
  onActive: (index: number) => void
  onPages: (count: number) => void
}) {
  const { lanes, kinds, label, icon, prompt } = palette
  const [selected, setSelected] = useState<string | null>(null)
  const [armed, setArmed] = useState<K | null>(null)
  const gesture = useRef<Gesture<K> | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  const current = fields.find((field) => field.key === selected)
  const laneName = (index: number) =>
    lanes[index]?.name || translate('signer', { value1: index + 1 })
  const caption = (field: DraftField<K>) =>
    prompt?.(field.kind) && field.label ? field.label : label(field.kind)

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
        onFields(deleteField(fields, selected))
        setSelected(null)
        return
      }
      const step = event.shiftKey ? 0.02 : 0.004
      const delta = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }[event.key]
      if (delta) {
        event.preventDefault()
        onFields(moveField(fields, selected, delta[0] ?? 0, delta[1] ?? 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fields, selected, onFields])

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
    const box =
      g.mode === 'move'
        ? clampBox({ ...g.start, x: g.start.x + dx, y: g.start.y + dy })
        : clampBox({ ...g.start, w: g.start.w + dx, h: g.start.h + dy })
    onFields(updateField(fields, g.key, { x: box.x, y: box.y, w: box.w, h: box.h }))
  }
  const endGesture = () => {
    gesture.current = null
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
    </div>
  )

  // Select a placed field from the list and bring it into view (its page, if still drawing).
  const reveal = (field: DraftField<K>) => {
    setSelected(field.key)
    onActive(field.signer)
    setArmed(null)
    const target =
      pane.current?.querySelector(`[data-field-key="${field.key}"]`) ??
      pane.current?.querySelector(`[aria-label="Page ${field.page}"]`)
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }
  const remove = (key: string) => {
    onFields(deleteField(fields, key))
    if (selected === key) setSelected(null)
  }
  const used = lanes
    .map((lane, index) => ({
      index,
      name: lane.name || laneName(index),
      items: fields.filter((field) => field.signer === index).toSorted((a, b) => a.page - b.page),
    }))
    .filter((group) => group.items.length > 0)

  const question = current && prompt?.(current.kind)
  // A field can move only to a lane that offers its kind (client data stays client data).
  const movableTo = current
    ? lanes.map((_, index) => index).filter((index) => kinds(index).includes(current.kind))
    : []

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label={translate('fieldPalette')}
        className="flex w-[280px] shrink-0 flex-col gap-5 overflow-y-auto border-r p-4"
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
                className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] transition-colors hover:bg-foreground/[0.045] aria-pressed:bg-foreground/[0.06] aria-pressed:font-medium"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: signerColor(index) }}
                />
                <span className="min-w-0 flex-1 truncate">{lane.name || laneName(index)}</span>
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
                className="flex h-10 cursor-grab items-center gap-2.5 rounded-lg border border-dashed bg-card px-2.5 text-left text-[13.5px] transition-colors hover:bg-foreground/[0.03] active:cursor-grabbing aria-pressed:border-solid"
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
        className="flex w-[260px] shrink-0 flex-col gap-5 overflow-y-auto border-l p-4"
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
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
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
                        title={label(field.kind)}
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
          <section className="grid gap-2 rounded-xl border p-3">
            <div className="flex items-center gap-2">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: signerColor(current.signer) }}
              />
              <p className="flex-1 text-[13.5px] font-medium">{label(current.kind)}</p>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate('deselect')}
                className="cursor-pointer"
                onClick={() => setSelected(null)}
              >
                <X />
              </Button>
            </div>
            {question && (
              <label className="grid gap-1 text-[12.5px] text-muted-foreground">
                {question}
                <input
                  value={current.label ?? ''}
                  maxLength={100}
                  placeholder={translate('eGJobTitle')}
                  onChange={(event) =>
                    onFields(updateField(fields, current.key, { label: event.target.value }))
                  }
                  className="h-8 rounded-md border bg-transparent px-2 text-[13.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>
            )}
            {movableTo.length > 1 && (
              <label className="grid gap-1 text-[12.5px] text-muted-foreground">
                {translate('signer2')}
                <NativeSelect
                  value={current.signer}
                  onChange={(event) => {
                    onFields(
                      updateField(fields, current.key, { signer: Number(event.target.value) }),
                    )
                    onActive(Number(event.target.value))
                  }}
                  className="h-8 text-[13.5px] text-foreground"
                >
                  {movableTo.map((index) => (
                    <option key={index} value={index}>
                      {laneName(index)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <Button
              variant="destructive-ghost"
              className="cursor-pointer justify-start gap-1.5 px-2"
              onClick={() => remove(current.key)}
            >
              <Trash2 className="size-4" />
              {translate('removeField')}
            </Button>
          </section>
        )}
      </aside>
    </div>
  )
}

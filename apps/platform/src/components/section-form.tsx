'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, type LucideIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ApiError, errorMessage } from '@/lib/api'

export type FieldErrors = Partial<Record<string, string>>

/** A 422's field messages ("seller.city": "…"), names mapped onto the form's; null for any other error. */
export function apiFieldErrors(
  error: unknown,
  rename: (name: string) => string = (name) => name,
): FieldErrors | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null
  const fields = error.details.fields
  if (typeof fields !== 'object' || fields === null) return null
  return Object.fromEntries(
    Object.entries(fields).flatMap(([name, message]) =>
      typeof message === 'string' ? [[rename(name), message]] : [],
    ),
  )
}

/** "dunning_levels.0.fee" belongs to the field "dunning_levels". */
const rootOf = (key: string) => key.split('.')[0] ?? key

/** `target` with `fields` taken from `source`. */
function withFields<V extends object>(target: V, source: V, fields: readonly (keyof V)[]): V {
  const next = { ...target }
  for (const field of fields) next[field] = source[field]
  return next
}

const inFields = (fields: readonly string[], key: string) => fields.includes(rootOf(key))

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const SAVED_FOR_MS = 2000

/** What a section card needs for its footer and its ⌘/Ctrl+Enter. */
export type SectionState = {
  dirty: boolean
  saving: boolean
  /** Just saved: true for about two seconds. */
  saved: boolean
  /** Another section of the same form is saving. */
  blocked: boolean
  save: () => void
  discard: () => void
  /** On the section's element: ⌘/Ctrl+Enter anywhere inside saves it. */
  attach: (element: HTMLElement | null) => (() => void) | undefined
}

/**
 * One form split into sections that each save on their own: a section's Save sends the last saved
 * values with only that section's edits on top, so another section's unsaved edits never go along.
 */
export function useSectionForm<V extends object, S extends string>({
  initial,
  sections,
  validate,
  save,
  fieldErrors,
  savedMessage,
}: {
  initial: V
  sections: readonly { id: S; fields: readonly (keyof V & string)[] }[]
  /** Problems by field ("name", or "dunning_levels.0.fee" inside a list). */
  validate?: (values: V) => FieldErrors
  /** `before` is what was saved last, for an API that takes only the changes. */
  save: (values: V, section: S, before: V) => Promise<unknown>
  /** The server's refusal on the form's fields, or null when it is not about fields. */
  fieldErrors?: (error: unknown) => FieldErrors | null
  savedMessage: (section: S) => string
}) {
  const [values, setValues] = useState(initial)
  const [base, setBase] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [saving, setSaving] = useState<S | null>(null)
  const [saved, setSaved] = useState<S | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const problems = validate?.(values) ?? {}
  // A field's own problem shows once it was edited; errors from a save always show.
  const shown: FieldErrors = {
    ...Object.fromEntries(Object.entries(problems).filter(([key]) => touched.has(rootOf(key)))),
    ...errors,
  }

  const clearErrors = (fields: readonly string[]) =>
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !inFields(fields, key))),
    )
  const touch = (field: keyof V & string) => setTouched((current) => new Set(current).add(field))
  const set = <K extends keyof V & string>(field: K, value: V[K]) => {
    touch(field)
    setValues((current) => ({ ...current, [field]: value }))
    clearErrors([field])
  }

  const fieldsOf = (id: S) => sections.find((section) => section.id === id)?.fields ?? []
  const isDirty = (id: S) => fieldsOf(id).some((field) => !same(values[field], base[field]))
  const dirtySections = sections.map((section) => section.id).filter(isDirty)

  const saveSection = (id: S) => {
    const fields = fieldsOf(id)
    if (saving !== null || !isDirty(id)) return
    const next = withFields(base, values, fields)
    const refused = Object.entries(validate?.(next) ?? {}).filter(([key]) => inFields(fields, key))
    if (refused.length > 0) {
      setTouched((current) => new Set([...current, ...fields]))
      setErrors((current) => ({ ...current, ...Object.fromEntries(refused) }))
      return void toast.error('Couldn’t save: check the highlighted fields.')
    }
    setSaving(id)
    save(next, id, base).then(
      () => {
        setSaving(null)
        setBase(next)
        clearErrors(fields)
        setSaved(id)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setSaved(null), SAVED_FOR_MS)
        toast.success(savedMessage(id))
      },
      (error: unknown) => {
        setSaving(null)
        const server = fieldErrors?.(error) ?? null
        if (server && Object.keys(server).length > 0) {
          setErrors((current) => ({ ...current, ...server }))
          toast.error('Couldn’t save: check the highlighted fields.')
        } else toast.error(errorMessage(error))
      },
    )
  }

  const saveOnShortcut = (id: S) => (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    saveSection(id)
  }

  const section = (id: S): SectionState => ({
    dirty: isDirty(id),
    saving: saving === id,
    saved: saved === id,
    blocked: saving !== null && saving !== id,
    save: () => saveSection(id),
    discard: () => {
      const fields = fieldsOf(id)
      setValues((current) => withFields(current, base, fields))
      clearErrors(fields)
      setTouched((current) => new Set([...current].filter((key) => !inFields(fields, key))))
    },
    attach: (element) => {
      if (!element) return
      const keydown = saveOnShortcut(id)
      element.addEventListener('keydown', keydown)
      return () => element.removeEventListener('keydown', keydown)
    },
  })

  useUnsavedChanges(dirtySections.length > 0)
  return { values, saved: base, set, touch, errors: shown, problems, section, dirtySections }
}

// Every form with unsaved edits on the page; the guard checks it when someone leaves.
const dirtyForms = new Set<string>()

/** Marks this form as holding unsaved edits, for `useLeaveGuard`. */
export function useUnsavedChanges(dirty: boolean) {
  const id = useId()
  useEffect(() => {
    if (!dirty) return
    dirtyForms.add(id)
    return () => void dirtyForms.delete(id)
  }, [dirty, id])
}

/**
 * Asks before leaving a page with unsaved edits: closing or reloading the tab (the browser's own
 * prompt), following a link, or a navigation passed through `leave`. Mount it once per page.
 */
export function useLeaveGuard() {
  const router = useRouter()
  const [pending, setPending] = useState<{ go: () => void } | null>(null)
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyForms.size > 0) event.preventDefault()
    }
    const click = (event: MouseEvent) => {
      if (dirtyForms.size === 0 || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.download) return
      const url = new URL(link.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      // Before Next's own link handler, so the navigation waits for the answer.
      event.preventDefault()
      event.stopPropagation()
      setPending({ go: () => router.push(`${url.pathname}${url.search}${url.hash}`) })
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', click, true)
    }
  }, [router])

  const leave = (go: () => void) => (dirtyForms.size > 0 ? setPending({ go }) : go())
  const dialog = pending && (
    <ConfirmDialog
      title="Leave without saving?"
      body="Some sections have changes that aren’t saved yet. Leaving discards them."
      confirmLabel="Discard and leave"
      cancelLabel="Stay"
      tone="destructive"
      onDecide={(approved) => {
        setPending(null)
        if (approved) pending.go()
      }}
    />
  )
  return { leave, dialog }
}

/**
 * A section's icon before its title: a tile tinted in the section accent, so it stays apart from the
 * neutral, outlined icons of the rows inside the section. The same icon marks it in the nav.
 */
export function SectionIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="section-icon"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-lg bg-section-icon-surface text-section-icon',
        className,
      )}
    >
      <Icon className="size-[15px] stroke-[1.75]" />
    </span>
  )
}

/** The dot that says a section has unsaved edits, in the footer and in the section nav. */
export function UnsavedDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full bg-link', className)} />
}

/**
 * A section's Discard/Save bar, under its fields: quiet while nothing changed, tinted with
 * "Unsaved changes" while something did, and then on phones stuck to the bottom of the screen.
 */
export function SectionFooter({ state, className }: { state: SectionState; className?: string }) {
  return (
    <div
      data-slot="section-footer"
      data-dirty={state.dirty || undefined}
      className={cn(
        'flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg py-1.5 transition-colors',
        state.dirty
          ? 'bg-muted px-3 ring-1 ring-border max-sm:sticky max-sm:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-sm:z-10'
          : 'px-0',
        className,
      )}
    >
      <output aria-live="polite" className="flex min-w-0 items-center gap-2 text-[13px]">
        {/* Fades out over the last half second before it goes. */}
        {state.saved && !state.dirty ? (
          <span className="flex animate-out items-center gap-1.5 font-medium text-success delay-1500 duration-500 fill-mode-forwards fade-out">
            <Check className="size-4" aria-hidden /> Saved
          </span>
        ) : state.dirty ? (
          <span className="flex items-center gap-2 font-medium text-foreground">
            <UnsavedDot /> Unsaved changes
          </span>
        ) : null}
      </output>
      <div className="ml-auto flex items-center gap-2">
        {state.dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={state.saving}
            onClick={state.discard}
          >
            Discard
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          aria-keyshortcuts="Meta+Enter Control+Enter"
          disabled={!state.dirty || state.saving || state.blocked}
          onClick={state.save}
        >
          {state.saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

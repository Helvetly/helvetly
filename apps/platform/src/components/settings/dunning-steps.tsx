'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Switch } from '@helvetly/ui/components/switch'
import { cn } from '@helvetly/ui/lib/utils'
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { inputClass } from '@/components/clients/fields'
import type { FieldErrors } from '@/components/section-form'
import { parseDecimalInput, type DunningTiming } from '@/lib/invoices'

import { SettingsPreview } from './layout'
import { UnitInput } from './unit-input'

/** One step of settings.dunning.steps as typed. */
export type StepDraft = {
  key: string
  name: string
  timing: DunningTiming
  days: string
  fee: string
  text: string
  qr_bill: boolean
}

export const MAX_STEPS = 10
const MAX_DAYS_BEFORE = 30

const isNote = (step: StepDraft) => step.timing === 'before_due'

/** Each step's planned day from the due date (negative before it), as the API orders them. */
export function plannedDays(steps: StepDraft[]): number[] {
  const out: number[] = []
  steps.forEach((step, i) => {
    const days = Number(step.days) || 0
    const before = out[i - 1]
    out.push(
      step.timing === 'before_due'
        ? -days
        : step.timing === 'after_previous' && before !== undefined
          ? before + days
          : days,
    )
  })
  return out
}

/** Why a step can't be where it is in the list, as the API words it; '' when it can. */
export function timingProblems(steps: StepDraft[]): string[] {
  const at = plannedDays(steps)
  return steps.map((step, i) => {
    const previous = steps[i - 1]
    if (step.timing === 'after_previous' && !previous)
      return 'The first reminder counts from the due date.'
    if (step.timing === 'after_previous' && previous && isNote(previous))
      return 'Count from the due date after a note before it.'
    if (i > 0 && (at[i] ?? 0) <= (at[i - 1] ?? 0))
      return 'Each reminder must come after the one before it.'
    return ''
  })
}

/** A fee as typed is valid from 0 to 1000.00, in steps of 0.05 (CHF cash rounding). */
export function validFee(typed: string): boolean {
  const fee = parseDecimalInput(typed || '0', 2)
  if (fee === null || fee.startsWith('-')) return false
  const cents = Math.round(Number(fee) * 100)
  return cents <= 100_000 && cents % 5 === 0
}

/** One step's own problems, by field. */
export function stepErrors(step: StepDraft): FieldErrors {
  const errors: FieldErrors = {}
  const most = isNote(step) ? MAX_DAYS_BEFORE : 90
  const days = Number(step.days)
  if (!/^\d{1,3}$/.test(step.days) || days < 1 || days > most)
    errors.days = `From 1 to ${most} days.`
  if (!isNote(step) && !validFee(step.fee)) errors.fee = 'From 0 to 1000.00, in steps of 0.05.'
  if (step.name.trim().length > 60) errors.name = 'At most 60 characters.'
  return errors
}

/** The list in planned order; a step moved by its timing lands where it goes out. */
export function sortSteps(steps: StepDraft[]): StepDraft[] {
  const at = plannedDays(steps)
  return steps
    .map((step, i) => ({ step, at: at[i] ?? 0, i }))
    .toSorted((a, b) => a.at - b.at || a.i - b.i)
    .map(({ step }) => step)
}

/** The step's name, else its standard title (in English here; the client gets the invoice's language). */
export function stepTitle(steps: StepDraft[], index: number): string {
  const step = steps[index]
  if (!step) return ''
  if (step.name.trim()) return step.name.trim()
  if (isNote(step)) return 'Payment due soon'
  const ranks = steps.filter((s) => !isNote(s)).length
  const rank = steps.slice(0, index + 1).filter((s) => !isNote(s)).length
  return rank <= 1 ? 'Payment reminder' : rank >= ranks ? 'Final reminder' : `Reminder ${rank}`
}

const STANDARD = {
  note: 'A friendly note that invoice [number] of [date] is due on [due date].',
  first:
    'According to our records, invoice [number] of [date], due on [due date], has not been paid yet. Please settle the open amount.',
  middle:
    'Despite our reminder, invoice [number] of [date], due on [due date], is still open. Please transfer the amount without delay.',
  final:
    'Invoice [number] of [date], due on [due date], remains unpaid despite our reminders. Without payment we reserve further steps, in particular debt collection.',
}

/** The standard sentence the step sends when it has no own text, in English. */
export function standardText(steps: StepDraft[], index: number): string {
  const title = stepTitle(
    steps.map((step) => ({ ...step, name: '' })),
    index,
  )
  if (title === 'Payment due soon') return STANDARD.note
  if (title === 'Payment reminder') return STANDARD.first
  return title === 'Final reminder' ? STANDARD.final : STANDARD.middle
}

const dayCount = (typed: string) => {
  const days = Number(typed) || 0
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

const WHEN: Record<DunningTiming, string> = {
  before_due: 'before due',
  after_due: 'after due',
  after_previous: 'after the previous',
}

/** One line on a step: "10 days after due · CHF 20.00 fee · own text". */
export function stepSummary(step: StepDraft, currency: string): string {
  const fee = Number(parseDecimalInput(step.fee || '0', 2) ?? 0)
  const parts = [
    `${dayCount(step.days)} ${WHEN[step.timing]}`,
    isNote(step) ? 'friendly note' : fee > 0 ? `${currency} ${fee.toFixed(2)} fee` : 'no fee',
    step.text.trim() ? 'own text' : 'standard text',
  ]
  if (!step.qr_bill) parts.push('no QR bill')
  return parts.join(' · ')
}

/** What a new step starts as: after the last one, or the first reminder after the due date. */
function newStep(steps: StepDraft[]): StepDraft {
  const last = steps.at(-1)
  const after = last && !isNote(last)
  return {
    key: crypto.randomUUID(),
    name: '',
    timing: after ? 'after_previous' : 'after_due',
    days: after ? '14' : '10',
    fee: '0.00',
    text: '',
    qr_bill: true,
  }
}

const errorsOf = (errors: FieldErrors, index: number) =>
  Object.fromEntries(
    Object.entries(errors).flatMap(([key, message]) =>
      key.startsWith(`dunning_steps.${index}.`)
        ? [[key.slice(`dunning_steps.${index}.`.length), message]]
        : [],
    ),
  ) as FieldErrors

/**
 * The steps as a compact timeline around the due date: one row per step with its one-line summary
 * and Edit. Editing happens in a dialog whose Apply changes the section's draft; the section's Save
 * sends it. A step with a problem (also from the server) is marked and its dialog shows it.
 */
export function DunningSteps({
  steps,
  currency,
  errors,
  onChange,
}: {
  steps: StepDraft[]
  currency: string
  /** The section's errors: "dunning_steps.1.fee", or "dunning_steps" for the list. */
  errors: FieldErrors
  onChange: (steps: StepDraft[]) => void
}) {
  // The step in the dialog: index null while adding one.
  const [open, setOpen] = useState<{ index: number | null; step: StepDraft } | null>(null)
  const firstAfterDue = steps.findIndex((step) => !isNote(step))
  const entries: (number | 'due')[] = steps.map((_, i) => i)
  entries.splice(firstAfterDue === -1 ? steps.length : firstAfterDue, 0, 'due')

  return (
    <div className="grid gap-2">
      <ol aria-label="Reminders" className="grid">
        {entries.map((entry, n) => {
          const rail = { first: n === 0, last: n === entries.length - 1 }
          if (entry === 'due')
            return (
              <li key="due" className="relative flex items-center gap-3 py-1.5">
                <Rail {...rail} center={18} />
                <span
                  aria-hidden
                  className="z-[1] flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border"
                >
                  <CalendarClock className="size-3.5 stroke-[1.75]" />
                </span>
                <span className="text-body-sm font-medium text-muted-foreground">Due date</span>
              </li>
            )
          const step = steps[entry]
          if (!step) return null
          const problem = Object.values(errorsOf(errors, entry))[0]
          const title = stepTitle(steps, entry)
          return (
            <li key={step.key} className="relative flex items-start gap-3">
              <Rail {...rail} center={24} />
              <span
                aria-hidden
                className={cn(
                  'z-[1] mt-3 flex size-6 shrink-0 items-center justify-center rounded-full bg-card text-caption font-medium text-muted-foreground tabular-nums ring-1 ring-border',
                  problem && 'text-destructive ring-destructive/60',
                )}
              >
                {entry + 1}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-body font-medium">{title}</span>
                  <span className="text-body-sm text-pretty text-muted-foreground">
                    {stepSummary(step, currency)}
                  </span>
                  {problem && <span className="text-xs text-destructive">{problem}</span>}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${title}`}
                  onClick={() => setOpen({ index: entry, step })}
                >
                  <Pencil aria-hidden /> Edit
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
      {errors.dunning_steps && <p className="text-xs text-destructive">{errors.dunning_steps}</p>}
      {steps.length < MAX_STEPS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setOpen({ index: null, step: newStep(steps) })}
        >
          <Plus aria-hidden /> Add a reminder
        </Button>
      )}
      {open && (
        <StepDialog
          step={open.step}
          steps={steps}
          index={open.index}
          currency={currency}
          serverErrors={open.index === null ? {} : errorsOf(errors, open.index)}
          onApply={(next) => {
            onChange(next)
            setOpen(null)
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

/** The line joining the timeline's markers, from the first marker's centre to the last one's. */
function Rail({ first, last, center }: { first: boolean; last: boolean; center: number }) {
  if (first && last) return null
  return (
    <span
      aria-hidden
      style={{ top: first ? center : 0, ...(last ? { height: center } : { bottom: 0 }) }}
      className="absolute left-[11.5px] w-px bg-border"
    />
  )
}

const TIMINGS: { value: DunningTiming; label: string }[] = [
  { value: 'before_due', label: 'Before due' },
  { value: 'after_due', label: 'After due' },
  { value: 'after_previous', label: 'After previous' },
]

const DAYS_SUFFIX: Record<DunningTiming, string> = {
  before_due: 'days before the due date',
  after_due: 'days after the due date',
  after_previous: 'days after the previous one',
}

const id = (field: string) => `dunning-step-${field}`

const fieldInput = cn(inputClass, 'placeholder:text-placeholder')

function StepDialog({
  step,
  steps,
  index,
  currency,
  serverErrors,
  onApply,
  onClose,
}: {
  step: StepDraft
  steps: StepDraft[]
  /** null for a new step. */
  index: number | null
  currency: string
  serverErrors: FieldErrors
  onApply: (steps: StepDraft[]) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(step)
  const [errors, setErrors] = useState<FieldErrors>(serverErrors)
  const [confirming, setConfirming] = useState(false)
  const set = (change: Partial<StepDraft>) => {
    setDraft((current) => ({ ...current, ...change }))
    setErrors((current) => {
      const next = { ...current }
      for (const field of Object.keys(change)) delete next[field]
      // the place in the list follows the timing and the days
      if ('timing' in change || 'days' in change) delete next.timing
      return next
    })
  }

  const withDraft =
    index === null ? [...steps, draft] : steps.map((s, i) => (i === index ? draft : s))
  const at = withDraft.indexOf(draft)
  const title = stepTitle(withDraft, at)

  const apply = () => {
    const next = sortSteps(withDraft)
    const problems = timingProblems(next)
    const mine = next.indexOf(draft)
    // the edited step's own problem, else the first it causes for another
    const bad = problems[mine] ? mine : problems.findIndex(Boolean)
    const problem =
      bad === -1 ? '' : `${bad === mine ? '' : `${stepTitle(next, bad)}: `}${problems[bad]}`
    const found = { ...stepErrors(draft), ...(problem ? { timing: problem } : {}) }
    if (Object.keys(found).length > 0) return setErrors(found)
    const kept = isNote(draft) ? { ...draft, fee: '0.00' } : draft
    onApply(next.map((s) => (s === draft ? kept : s)))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{index === null ? 'New reminder' : `Edit ${title}`}</DialogTitle>
          <DialogDescription>Applies to the section; Save there to keep it.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
          className="grid gap-5"
        >
          <FormField
            id={id('name')}
            label="Name"
            error={errors.name}
            hint="Leave empty for the standard title in the invoice’s language."
          >
            <input
              {...describedBy(id('name'), errors.name)}
              value={draft.name}
              maxLength={60}
              placeholder={stepTitle(
                withDraft.map((s) => (s === draft ? { ...s, name: '' } : s)),
                at,
              )}
              onChange={(e) => set({ name: e.target.value })}
              className={fieldInput}
            />
          </FormField>
          <FormField id={id('days')} label="When" error={errors.days ?? errors.timing} group>
            <Segmented
              label="When"
              fill
              value={draft.timing}
              options={TIMINGS}
              onChange={(timing) => set({ timing })}
            />
            <UnitInput
              {...describedBy(id('days'), errors.days ?? errors.timing)}
              inputMode="numeric"
              aria-label="Days"
              unit={DAYS_SUFFIX[draft.timing]}
              value={draft.days}
              onChange={(e) => set({ days: e.target.value.replace(/\D/g, '').slice(0, 2) })}
              className="mt-1 w-56"
            />
          </FormField>
          {isNote(draft) ? (
            <SettingsPreview label="About notes">
              A note before the due date is friendly: no fee, no interest, no overdue wording.
            </SettingsPreview>
          ) : (
            <FormField
              id={id('fee')}
              label="Fee"
              error={errors.fee}
              tip="Charged only if agreed with the client, e.g. in your terms. In the invoice’s currency; 0 for none."
            >
              <UnitInput
                {...describedBy(id('fee'), errors.fee)}
                inputMode="decimal"
                unit={currency}
                value={draft.fee}
                placeholder="0.00"
                onChange={(e) => set({ fee: e.target.value })}
                className="w-56"
              />
            </FormField>
          )}
          <div className="flex items-center justify-between gap-4 text-body">
            <label htmlFor={id('qr')} className="grid gap-0.5">
              <span className="font-medium">QR bill</span>
              <span className="text-body-sm text-muted-foreground">
                Attach a QR bill for the total to the letter.
              </span>
            </label>
            <Switch
              id={id('qr')}
              checked={draft.qr_bill}
              onCheckedChange={(qr_bill) => set({ qr_bill })}
            />
          </div>
          <FormField
            id={id('text')}
            label="Own text"
            error={errors.text}
            hint="Leave empty for the standard text in the invoice’s language."
          >
            <textarea
              {...describedBy(id('text'), errors.text)}
              rows={3}
              maxLength={1000}
              value={draft.text}
              onChange={(e) => set({ text: e.target.value })}
              className={cn(inputClass, 'min-h-20 py-2 text-body')}
            />
          </FormField>
          {!draft.text.trim() && (
            <SettingsPreview label="Standard text">
              <span className="block font-medium text-foreground">
                Standard text (shown in English)
              </span>
              {standardText(withDraft, at)}
            </SettingsPreview>
          )}
          <DialogFooter className="items-center sm:justify-between">
            {index !== null && steps.length > 1 ? (
              <Button
                type="button"
                variant="destructive-ghost"
                className="sm:mr-auto"
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden /> Remove reminder
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2 max-sm:grid max-sm:grid-cols-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">Apply</Button>
            </div>
          </DialogFooter>
        </form>
        {confirming && (
          <ConfirmDialog
            title={`Remove ${title}?`}
            body="It goes when you save the Dunning section. Notices already sent stay."
            confirmLabel="Remove"
            tone="destructive"
            onDecide={(approved) => {
              setConfirming(false)
              if (approved && index !== null) onApply(steps.filter((_, i) => i !== index))
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

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
import { translate } from '@/lib/i18n'
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
      return translate('theFirstReminderCountsFromTheDueDate')
    if (step.timing === 'after_previous' && previous && isNote(previous))
      return translate('countFromTheDueDateAfterANoteBefore')
    if (i > 0 && (at[i] ?? 0) <= (at[i - 1] ?? 0))
      return translate('eachReminderMustComeAfterTheOneBeforeIt')
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
    errors.days = translate('from1ToDays', { most: most })
  if (!isNote(step) && !validFee(step.fee)) errors.fee = translate('from0To100000InStepsOf0')
  if (step.name.trim().length > 60) errors.name = translate('atMost60Characters')
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
  if (isNote(step)) return translate('paymentDueSoon')
  const ranks = steps.filter((s) => !isNote(s)).length
  const rank = steps.slice(0, index + 1).filter((s) => !isNote(s)).length
  return rank <= 1
    ? translate('paymentReminder')
    : rank >= ranks
      ? translate('finalReminder')
      : translate('reminder', { rank: rank })
}

const STANDARD = {
  note: translate('aFriendlyNoteThatInvoiceNumberOfDateIs'),
  first: translate('accordingToOurRecordsInvoiceNumberOfDateDue'),
  middle: translate('despiteOurReminderInvoiceNumberOfDateDueOn'),
  final: translate('invoiceNumberOfDateDueOnDueDateRemains'),
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
  return translate('dunningDayCount', { count: days })
}

const WHEN: Record<DunningTiming, string> = {
  before_due: translate('beforeDue2'),
  after_due: translate('afterDue2'),
  after_previous: translate('afterThePrevious'),
}

/** One line on a step: "10 days after due · CHF 20.00 fee · own text". */
export function stepSummary(step: StepDraft, currency: string): string {
  const fee = Number(parseDecimalInput(step.fee || '0', 2) ?? 0)
  const parts = [
    `${dayCount(step.days)} ${WHEN[step.timing]}`,
    isNote(step)
      ? translate('friendlyNote')
      : fee > 0
        ? translate('dynamicFee', { currency: currency, value2: fee.toFixed(2) })
        : translate('noFee'),
    step.text.trim() ? translate('ownText2') : translate('standardText2'),
  ]
  if (!step.qr_bill) parts.push(translate('noQrBill'))
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
      <ol aria-label={translate('reminders')} className="grid">
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
                <span className="text-body-sm font-medium text-muted-foreground">
                  {translate('dueDate')}
                </span>
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
                  aria-label={translate('edit5', { title: title })}
                  onClick={() => setOpen({ index: entry, step })}
                >
                  <Pencil aria-hidden />
                  {translate('edit4')}
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
          <Plus aria-hidden />
          {translate('addAReminder')}
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
  { value: 'before_due', label: translate('beforeDue') },
  { value: 'after_due', label: translate('afterDue') },
  { value: 'after_previous', label: translate('afterPrevious') },
]

const DAYS_SUFFIX: Record<DunningTiming, string> = {
  before_due: translate('daysBeforeTheDueDate'),
  after_due: translate('daysAfterTheDueDate'),
  after_previous: translate('daysAfterThePreviousOne'),
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
          <DialogTitle>
            {index === null ? translate('newReminder') : translate('edit5', { title: title })}
          </DialogTitle>
          <DialogDescription>{translate('appliesToTheSectionSaveThereToKeepIt')}</DialogDescription>
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
            label={translate('name')}
            error={errors.name}
            hint={translate('leaveEmptyForTheStandardTitleInTheInvoice')}
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
          <FormField
            id={id('days')}
            required
            label={translate('when')}
            error={errors.days ?? errors.timing}
            group
          >
            <Segmented
              label={translate('when')}
              fill
              value={draft.timing}
              options={TIMINGS}
              onChange={(timing) => set({ timing })}
            />
            <UnitInput
              {...describedBy(id('days'), errors.days ?? errors.timing)}
              inputMode="numeric"
              aria-label={translate('days2')}
              unit={DAYS_SUFFIX[draft.timing]}
              value={draft.days}
              onChange={(e) => set({ days: e.target.value.replace(/\D/g, '').slice(0, 2) })}
              className="mt-1 w-56"
            />
          </FormField>
          {isNote(draft) ? (
            <SettingsPreview label={translate('aboutNotes')}>
              {translate('aNoteBeforeTheDueDateIsFriendlyNo')}
            </SettingsPreview>
          ) : (
            <FormField
              id={id('fee')}
              label={translate('fee2')}
              error={errors.fee}
              tip={translate('chargedOnlyIfAgreedWithTheClientEG')}
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
              <span className="font-medium">{translate('qrBill')}</span>
              <span className="text-body-sm text-muted-foreground">
                {translate('attachAQRBillForTheTotalToThe')}
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
            label={translate('ownText')}
            error={errors.text}
            hint={translate('leaveEmptyForTheStandardTextInTheInvoice')}
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
            <SettingsPreview label={translate('standardText')}>
              <span className="block font-medium text-foreground">
                {translate('standardTextShownInEnglish')}
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
                <Trash2 aria-hidden />
                {translate('removeReminder')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2 max-sm:grid max-sm:grid-cols-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {translate('cancel')}
              </Button>
              <Button type="submit">{translate('apply')}</Button>
            </div>
          </DialogFooter>
        </form>
        {confirming && (
          <ConfirmDialog
            title={translate('remove9', { title: title })}
            body={translate('itGoesWhenYouSaveTheDunningSectionNotices')}
            confirmLabel={translate('remove7')}
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

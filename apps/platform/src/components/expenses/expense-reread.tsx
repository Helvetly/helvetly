'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Loader } from '@helvetly/ui/components/loader'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { isAIConsentRequired, useAIApproval } from '@/components/ai/ai-approval'
import { promptUpgrade, toastError } from '@/components/billing/upgrade-prompt'
import { CURRENCY_OPTIONS } from '@/components/clients/fields'
import { approvalKeys } from '@/lib/approvals'
import {
  rereadExpense,
  useSaveExpense,
  type Expense,
  type ReceiptSuggestions,
} from '@/lib/expenses'
import { usageKey } from '@/lib/heidi'
import { translate } from '@/lib/i18n'
import { useInvoiceSettings } from '@/lib/invoices'
import { useSession } from '@/lib/queries'

import { toInput, valuesFromExpense } from './expense-form-model'
import { readFailure, ReadFailureAlert, type ReadFailure } from './expense-read-failure'
import { applyReread, recognizedLabel, rereadRows, type RereadField } from './expense-reread-model'

type State =
  | { phase: 'reading' }
  | { phase: 'failed'; failure: ReadFailure }
  | { phase: 'read'; suggestions: ReceiptSuggestions }

/**
 * A draft's receipts read again, in place of the drawer's detail: what the AI reads beside what the draft has, each
 * difference with a checkbox (an empty field's is ticked). Applying saves the chosen ones as an ordinary edit, which
 * asks an open approval again. Nothing changes until then.
 */
export function ExpenseReread({ expense, onDone }: { expense: Expense; onDone: () => void }) {
  const { ensure } = useAIApproval()
  const queryClient = useQueryClient()
  const session = useSession().data
  const registered = useInvoiceSettings().data?.vat_registered ?? true
  const save = useSaveExpense()
  const [state, setState] = useState<State>({ phase: 'reading' })
  const [chosen, setChosen] = useState<Set<RereadField> | null>(null)
  const alive = useRef(true)
  const started = useRef(false)
  const options = {
    registered,
    currencyOk: (code: string) => CURRENCY_OPTIONS.some((option) => option.value === code),
  }

  const read = async () => {
    setState({ phase: 'reading' })
    setChosen(null)
    try {
      // "Not now" to the first-use approval reads nothing and goes back.
      if (!(await ensure())) return alive.current && onDone()
      let suggestions
      try {
        suggestions = await rereadExpense(expense.id, crypto.randomUUID())
      } catch (error) {
        if (!isAIConsentRequired(error)) throw error
        await queryClient.invalidateQueries({ queryKey: usageKey })
        if (!(await ensure())) return alive.current && onDone()
        suggestions = await rereadExpense(expense.id, crypto.randomUUID())
      }
      if (alive.current) setState({ phase: 'read', suggestions })
    } catch (error) {
      promptUpgrade(error)
      if (alive.current) setState({ phase: 'failed', failure: readFailure(error) })
    }
  }
  // Once per opening: a development re-run of the effect must not read (and charge) twice.
  useEffect(() => {
    alive.current = true
    if (!started.current) {
      started.current = true
      void read()
    }
    return () => {
      alive.current = false
    }
  })

  const values = valuesFromExpense(expense)
  const rows = state.phase === 'read' ? rereadRows(values, expense, state.suggestions, options) : []
  const picked = chosen ?? new Set(rows.filter((row) => row.empty).map((row) => row.field))
  const toggle = (field: RereadField, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(field)
    else next.delete(field)
    setChosen(next)
  }

  const apply = async () => {
    if (state.phase !== 'read' || !picked.size) return
    const next = applyReread(values, state.suggestions, picked, options)
    try {
      const saved = await save.mutateAsync({
        id: expense.id,
        input: toInput(next, {
          userId: session?.user.id,
          baseCurrency: expense.base.currency,
          booked: false,
        }),
      })
      void queryClient.invalidateQueries({
        queryKey: approvalKeys.of({ doc: 'expenses', id: expense.id }),
      })
      void queryClient.invalidateQueries({ queryKey: approvalKeys.inbox })
      toast.success(
        expense.approval_state === 'pending' || expense.approval_state === 'approved'
          ? translate('rereadAppliedApprovalAgain', { number: saved.number })
          : translate('rereadApplied', { number: saved.number }),
      )
      onDone()
    } catch (error) {
      toastError(error)
    }
  }

  const issues = state.phase === 'read' ? Object.values(state.suggestions.issues) : []
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b border-border/60 bg-card/95 px-3 backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={translate('rereadBack')}
          className="cursor-pointer"
          onClick={onDone}
        >
          <ArrowLeft />
        </Button>
        <h2 className="ml-1 inline-flex items-center gap-1.5 text-body-sm font-medium">
          <HeidiSparkle />
          {translate('readAgainWithAI')}
        </h2>
      </header>

      <div className="grid flex-1 content-start gap-5 px-6 pt-6 pb-8">
        {state.phase === 'reading' && (
          <div className="grid justify-items-center gap-2 py-10 text-center">
            <HeidiSparkle animated className="size-6" />
            <p className="text-body font-medium">{translate('readingTheReceipt')}</p>
            <Loader label={translate('readingTheReceipt')} className="min-h-12" />
          </div>
        )}

        {state.phase === 'failed' && (
          <ReadFailureAlert failure={state.failure}>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                onClick={() => void read()}
              >
                {translate('tryAgain')}
              </Button>
              <Button size="sm" variant="ghost" className="cursor-pointer" onClick={onDone}>
                {translate('rereadBack')}
              </Button>
            </div>
          </ReadFailureAlert>
        )}

        {state.phase === 'read' && (
          <>
            <p className="text-body-sm text-muted-foreground">
              {rows.length ? translate('rereadIntro') : translate('rereadNothingNew')}
            </p>
            {issues.length > 0 && (
              <Callout tone="warning" title={translate('checkTheReading')}>
                <ul className="grid gap-1 text-muted-foreground">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </Callout>
            )}
            {rows.length > 0 && (
              <ul aria-label={translate('differences')} className="grid gap-2">
                {rows.map((row) => {
                  const id = `reread-${row.field}`
                  return (
                    <li key={row.field}>
                      <label
                        htmlFor={id}
                        className="grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-xl px-4 py-3 ring-1 ring-border hover:bg-muted/40"
                      >
                        <Checkbox
                          id={id}
                          className="mt-0.5"
                          checked={picked.has(row.field)}
                          onCheckedChange={(on) => toggle(row.field, on === true)}
                        />
                        <span className="grid gap-1">
                          <span className="text-body-sm font-medium">
                            {recognizedLabel(row.field)}
                          </span>
                          <span className="grid gap-1 text-body-sm sm:grid-cols-2 sm:gap-4">
                            <span className="grid">
                              <span className="text-xs text-muted-foreground">
                                {translate('rereadNow')}
                              </span>
                              <span className={row.now ? 'break-words' : 'text-muted-foreground'}>
                                {row.now || translate('emptyValue')}
                              </span>
                            </span>
                            <span className="grid">
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <HeidiSparkle className="size-3" />
                                {translate('onTheReceipt')}
                              </span>
                              <span className="break-words">{row.read}</span>
                            </span>
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {state.phase === 'read' && (
        <div className="sticky bottom-0 flex items-center gap-2 border-t bg-card px-6 py-3">
          <Button variant="ghost" className="ml-auto cursor-pointer" onClick={onDone}>
            {rows.length ? translate('cancel') : translate('rereadBack')}
          </Button>
          {rows.length > 0 && (
            <Button
              disabled={!picked.size || save.isPending}
              className="cursor-pointer"
              onClick={() => void apply()}
            >
              {save.isPending
                ? translate('saving')
                : translate('applyChanges', { count: picked.size })}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

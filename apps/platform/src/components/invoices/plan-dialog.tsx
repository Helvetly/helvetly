'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { inputClass, NativeSelect } from '@/components/clients/fields'
import { ApiError, errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import type { Plan } from '@/lib/instalments'
import {
  formatDay,
  INTERVALS,
  invoiceKeys,
  invoicesApi,
  today,
  type InvoiceSettings,
  type PlanInput,
} from '@/lib/invoices'

import { DateField } from './date-fields'
import { planKeys } from './plan-card'

const fieldErrors = (error: unknown): Record<string, string> => {
  if (!(error instanceof ApiError) || error.status !== 422) return {}
  const fields = error.details.fields
  if (typeof fields !== 'object' || fields === null) return {}
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

/** "Split into instalment invoices": a plan that issues one partial invoice per instalment. */
export function PlanDialog({
  invoiceId,
  settings,
  firstDue,
  onClose,
  onCreated,
}: {
  invoiceId: string
  settings: InvoiceSettings
  firstDue: string
  onClose: () => void
  onCreated: (plan: Plan) => void
}) {
  const defaults = settings.instalments
  const [count, setCount] = useState(String(defaults?.count ?? 3))
  const [interval, setEvery] = useState(defaults?.interval ?? 'monthly')
  const [first, setFirst] = useState(firstDue < today() ? today() : firstDue)
  const [lead, setLead] = useState(String(defaults?.plan_lead_days ?? 10))
  const [autoSend, setAutoSend] = useState(defaults?.plan_auto_send ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const queryClient = useQueryClient()
  const create = useMutation<Plan, ApiError, PlanInput>({
    mutationFn: async (body) => (await invoicesApi.createPlan(invoiceId, body)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) })
      void queryClient.invalidateQueries({ queryKey: planKeys.all })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found: Record<string, string> = {}
    const n = Number(count)
    if (!/^\d+$/.test(count) || n < 2 || n > 12) found.count = translate('from2To12Instalments')
    if (!first || first < today()) found.first_due_date = translate('notBeforeToday')
    const days = Number(lead)
    if (!/^\d+$/.test(lead) || days > 60) found.lead_days = translate('from0To60Days')
    setErrors(found)
    if (Object.keys(found).length) return
    create.mutate(
      { count: n, interval, first_due_date: first, lead_days: days, auto_send: autoSend },
      {
        onSuccess: (plan) => {
          const next = plan.items[0]
          toast.success(
            translate('planCreatedInvoices', {
              count: plan.count,
              value2: next ? translate('theFirstIssued', { value1: formatDay(next.issue_on) }) : '',
            }),
          )
          onCreated(plan)
        },
        onError: (error) => {
          const fromServer = fieldErrors(error)
          if (Object.keys(fromServer).length) setErrors(fromServer)
          else toast.error(errorMessage(error))
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-2rem))] max-w-none! gap-0 rounded-2xl p-0">
        <form noValidate onSubmit={submit}>
          <div className="grid gap-1 px-6 pt-6">
            <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">
              {translate('splitIntoInstalmentInvoices')}
            </DialogTitle>
            <DialogDescription className="text-[13.5px]">
              {translate('eachInstalmentBecomesItsOwnPartialInvoiceIssuedBefore')}
            </DialogDescription>
          </div>
          <div className="grid gap-4 px-6 pt-5 pb-6">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                id="plan-count"
                label={translate('instalments2')}
                required
                error={errors.count}
              >
                <input
                  {...describedBy('plan-count', errors.count)}
                  inputMode="numeric"
                  value={count}
                  onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  className={inputClass}
                />
              </FormField>
              <FormField id="plan-interval" label={translate('every')} error={errors.interval}>
                <NativeSelect
                  {...describedBy('plan-interval', errors.interval)}
                  value={interval}
                  onChange={(e) => {
                    const picked = INTERVALS.find((entry) => entry.value === e.target.value)
                    if (picked) setEvery(picked.value)
                  }}
                >
                  {INTERVALS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>
            <FormField
              id="plan-first"
              label={translate('firstDueDate')}
              required
              error={errors.first_due_date}
            >
              <DateField
                id="plan-first"
                label={translate('firstDueDate')}
                value={first}
                min={today()}
                invalid={Boolean(errors.first_due_date)}
                onChange={setFirst}
              />
            </FormField>
            <FormField
              id="plan-lead"
              required
              label={translate('issueDaysBeforeDue')}
              error={errors.lead_days}
              tip={translate('eachInvoiceIsIssuedThisManyDaysBeforeIts')}
            >
              <input
                {...describedBy('plan-lead', errors.lead_days)}
                inputMode="numeric"
                value={lead}
                onChange={(e) => setLead(e.target.value.replace(/\D/g, '').slice(0, 2))}
                className={inputClass}
              />
            </FormField>
            <SwitchRow
              id="plan-auto-send"
              label={translate('sendAutomatically')}
              description={translate('emailEachInvoiceToTheClientWhenIssued')}
              checked={autoSend}
              onCheckedChange={setAutoSend}
            />
          </div>
          <div className="flex items-center gap-2 border-t border-border/70 px-6 py-3">
            <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? translate('working') : translate('createPlan')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

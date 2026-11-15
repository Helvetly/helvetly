'use client'

import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { formatDate, formatMoney } from '@helvetly/ui/lib/format'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { inputClass, NativeSelect } from '@/components/clients/fields'
import { loadProblemText } from '@/components/data/load-problem'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { errorMessage } from '@/lib/api'
import {
  PAY_BASES,
  PAY_FREQUENCIES,
  useAddPayTerms,
  usePayTerms,
  type Employee,
  type PayBasis,
  type PayFrequency,
} from '@/lib/employees'
import { useCan } from '@/lib/permissions'

const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP']
const basisLabel = (basis: PayBasis) => PAY_BASES.find((entry) => entry.value === basis)?.label
const frequencyLabel = (frequency: PayFrequency) =>
  PAY_FREQUENCIES.find((entry) => entry.value === frequency)?.label

/** Pay terms with their history: each change is new terms from a date, the old ones stay. */
export function EmployeePay({ employee }: { employee: Employee }) {
  const query = usePayTerms(employee.id, true)
  const canWrite = useCan('write:payroll') && !employee.restricted && !employee.erased_at
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Panel
        title="Pay terms"
        action={
          canWrite &&
          !adding && (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add pay terms
            </Button>
          )
        }
      >
        {adding && <PayTermsForm employee={employee} onDone={() => setAdding(false)} />}
        {query.error ? (
          <p className="text-body-sm text-muted-foreground">
            {loadProblemText(query.error, 'The pay terms')}
          </p>
        ) : !query.data ? (
          <Loader className="h-16" />
        ) : query.data.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No pay terms recorded yet.</p>
        ) : (
          <ul className="grid">
            {query.data.map((terms) => (
              <li
                key={terms.id}
                className="grid gap-0.5 border-t border-border/60 py-2.5 first:border-t-0"
              >
                <span className="flex flex-wrap items-center gap-2 text-body">
                  <span className="font-medium tabular-nums">
                    {formatMoney(terms.amount, terms.currency)}
                  </span>
                  <span className="text-muted-foreground">
                    {basisLabel(terms.basis)} · paid{' '}
                    {frequencyLabel(terms.frequency)?.toLowerCase()}
                  </span>
                  {terms.current && <StatusBadge tone="green">Current</StatusBadge>}
                </span>
                <span className="text-body-sm text-muted-foreground">
                  From {formatDate(terms.effective_from)}
                  {terms.note && ` · ${terms.note}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="px-1 text-caption text-muted-foreground">
        Pay terms are a record of what was agreed. Helvetly does not calculate pay from them.
      </p>
    </>
  )
}

const id = (key: string) => `pay-terms-${key}`

function PayTermsForm({ employee, onDone }: { employee: Employee; onDone: () => void }) {
  const add = useAddPayTerms(employee.id)
  const [values, setValues] = useState({
    effective_from: '',
    basis: 'monthly' as PayBasis,
    amount: '',
    currency: 'CHF',
    frequency: 'monthly' as PayFrequency,
    note: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }
  const describe = (key: string) => ({
    id: id(key),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${id(key)}-error` : undefined,
  })

  return (
    <form
      noValidate
      aria-label="New pay terms"
      onSubmit={(event) => {
        event.preventDefault()
        add.mutate(
          { ...values, note: values.note.trim() || null },
          {
            onSuccess: () => {
              toast.success('Pay terms added.')
              onDone()
            },
            onError: (error) => {
              const fields = apiFieldErrors(error)
              if (fields && Object.keys(fields).length > 0) setErrors(fields)
              else toast.error(errorMessage(error))
            },
          },
        )
      }}
      className="mb-3 grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2"
    >
      <FormField
        id={id('effective_from')}
        label="Effective from"
        error={errors.effective_from}
        required
      >
        <input
          type="date"
          {...describe('effective_from')}
          value={values.effective_from}
          onChange={(event) => set('effective_from', event.target.value)}
          className={inputClass}
        />
      </FormField>
      <FormField id={id('basis')} label="Basis" error={errors.basis}>
        <NativeSelect
          {...describe('basis')}
          value={values.basis}
          onChange={(event) =>
            set(
              'basis',
              PAY_BASES.find((entry) => entry.value === event.target.value)?.value ?? 'monthly',
            )
          }
        >
          {PAY_BASES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id={id('amount')} label="Amount" error={errors.amount} required>
        <div className="flex gap-1.5">
          <input
            inputMode="decimal"
            placeholder="0.00"
            {...describe('amount')}
            value={values.amount}
            onChange={(event) => set('amount', event.target.value)}
            className={`${inputClass} text-right tabular-nums`}
          />
          <NativeSelect
            aria-label="Currency"
            wrapperClassName="w-24 shrink-0"
            value={values.currency}
            onChange={(event) => set('currency', event.target.value)}
          >
            {CURRENCIES.map((code) => (
              <option key={code}>{code}</option>
            ))}
          </NativeSelect>
        </div>
      </FormField>
      <FormField id={id('frequency')} label="Paid" error={errors.frequency}>
        <NativeSelect
          {...describe('frequency')}
          value={values.frequency}
          onChange={(event) =>
            set(
              'frequency',
              PAY_FREQUENCIES.find((entry) => entry.value === event.target.value)?.value ??
                'monthly',
            )
          }
        >
          {PAY_FREQUENCIES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id={id('note')} label="Note" error={errors.note} className="sm:col-span-2">
        <input
          {...describe('note')}
          value={values.note}
          onChange={(event) => set('note', event.target.value)}
          className={inputClass}
        />
      </FormField>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={add.isPending}>
          {add.isPending ? 'Saving…' : 'Add pay terms'}
        </Button>
      </div>
    </form>
  )
}

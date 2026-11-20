'use client'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { formatDate } from '@helvetly/ui/lib/format'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { isManager } from '@/components/settings/settings-tabs'
import { ApiError, errorMessage } from '@/lib/api'
import { booksApi, type AgreementInput } from '@/lib/books'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

const EMPTY = { starts_on: '', ends_on: '', accepted_by: '', note: '' }

/** The prior agreements a self-billed invoice for this client needs (EU VAT Directive Art. 224). */
export function SelfBillingAgreements({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient()
  const key = ['books', 'agreements', clientId]
  const manager = isManager(useSession().data?.role)
  const list = useQuery({
    queryKey: key,
    queryFn: async () => (await booksApi.agreements(clientId)).data,
  })
  const [adding, setAdding] = useState(false)
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  const create = useMutation({
    mutationFn: (input: AgreementInput) => booksApi.createAgreement(clientId, input),
    onSuccess: async () => {
      setAdding(false)
      setValues(EMPTY)
      toast.success(translate('agreementAdded'))
      await refresh()
    },
    onError: (error) => {
      const fields = error instanceof ApiError ? error.details.fields : null
      if (typeof fields === 'object' && fields !== null)
        setErrors(
          Object.fromEntries(
            Object.entries(fields).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          ),
        )
      else toast.error(errorMessage(error))
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => booksApi.deleteAgreement(clientId, id),
    onSuccess: async () => {
      toast.success(translate('agreementDeleted'))
      await refresh()
    },
    onError: toastError,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!values.starts_on) return setErrors({ starts_on: translate('enterTheStartDate') })
    create.mutate({
      starts_on: values.starts_on,
      ends_on: values.ends_on || null,
      accepted_by: values.accepted_by.trim() || null,
      note: values.note.trim() || null,
    })
  }
  const field = (name: keyof typeof EMPTY) => ({
    id: `sba-${name}`,
    value: values[name],
    'aria-invalid': errors[name] ? true : undefined,
    onChange: (event: { target: { value: string } }) => {
      setValues((current) => ({ ...current, [name]: event.target.value }))
      setErrors({})
    },
  })

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-medium">{translate('selfBillingAgreements')}</h2>
        {manager && !adding && (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus />
            {translate('addAgreement')}
          </Button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={submit}
          noValidate
          className="grid gap-3 rounded-xl bg-card p-4 shadow-elevation-1"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id="sba-starts_on"
              required
              label={translate('startsOn')}
              error={errors.starts_on}
            >
              <Input type="date" {...field('starts_on')} />
            </FormField>
            <FormField id="sba-ends_on" label={translate('endsOn2')} error={errors.ends_on}>
              <Input type="date" {...field('ends_on')} />
            </FormField>
          </div>
          <FormField
            id="sba-accepted_by"
            label={translate('acceptedBy')}
            error={errors.accepted_by}
          >
            <Input
              maxLength={200}
              placeholder={translate('nameAndRoleAtTheSupplier')}
              {...field('accepted_by')}
            />
          </FormField>
          <FormField id="sba-note" label={translate('note')} error={errors.note}>
            <Input
              maxLength={1000}
              placeholder={translate('whereTheSignedAgreementIsFiled')}
              {...field('note')}
            />
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? translate('saving') : translate('saveAgreement')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {translate('cancel')}
            </Button>
          </div>
        </form>
      )}

      {list.error ? (
        <p className="text-sm text-muted-foreground">{errorMessage(list.error)}</p>
      ) : !list.data ? (
        <Loader className="min-h-16" />
      ) : list.data.length === 0 ? (
        <p className="rounded-xl bg-card px-6 py-8 text-center text-[13px] text-muted-foreground shadow-elevation-1">
          {translate('noAgreementYetASelfBilledInvoiceForThis')}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl bg-card shadow-elevation-1">
          {list.data.map((agreement) => (
            <li key={agreement.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="grid gap-0.5">
                <span className="text-[14px]">
                  {formatDate(agreement.starts_on)} –{' '}
                  {agreement.ends_on ? formatDate(agreement.ends_on) : 'open-ended'}
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                  {[
                    agreement.accepted_by && `Accepted by ${agreement.accepted_by}`,
                    agreement.note,
                    agreement.first_used_at &&
                      `In use since ${formatDate(agreement.first_used_at)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {manager && !agreement.first_used_at && (
                <Button
                  variant="destructive-ghost"
                  size="icon-xs"
                  aria-label={translate('deleteAgreementFrom', {
                    value1: formatDate(agreement.starts_on),
                  })}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(agreement.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

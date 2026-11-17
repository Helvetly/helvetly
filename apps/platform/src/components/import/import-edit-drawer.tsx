'use client'
import { Button } from '@helvetly/ui/components/button'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { X } from 'lucide-react'
import { useState } from 'react'

import { Combobox, CURRENCY_OPTIONS, inputClass } from '@/components/clients/fields'
import { DateField } from '@/components/invoices/date-fields'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  displayValue,
  recordChanges,
  usePatchImportRecord,
  type ImportKindConfig,
  type ImportRecord,
} from '@/lib/imports'

import { ImportClientField } from './import-client-field'

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A date picked from the calendar; a value the model could not read as a date shows as "Choose a date". */
function ImportDateField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string
  label: string
  value: string
  error?: string
  onChange: (date: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <DateField
          id={id}
          label={label}
          value={CIVIL_DATE.test(value) ? value : ''}
          invalid={Boolean(error)}
          onChange={onChange}
          className="h-9 border border-input bg-card px-3 text-sm shadow-xs data-invalid:border-destructive"
        />
      </div>
      {value && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${translate('clearDate')}: ${label}`}
              onClick={() => onChange('')}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translate('clearDate')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/** An amount with its currency beside it: a picker where the record's currency is edited, its code otherwise. */
function ImportAmountField({
  id,
  value,
  currency,
  error,
  onChange,
  onCurrency,
}: {
  id: string
  value: string
  currency: string
  error?: string
  onChange: (amount: string) => void
  /** Without it the currency is shown, not changed (it is picked beside another amount of the record). */
  onCurrency?: (code: string) => void
}) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      {onCurrency ? (
        <Combobox
          id={`${id}-currency`}
          label={translate('currency')}
          value={currency}
          options={CURRENCY_OPTIONS}
          renderValue={(option) => option.value}
          placeholder={translate('chooseACurrency2')}
          onChange={onCurrency}
        />
      ) : (
        <span className={cn(inputClass, 'flex items-center bg-muted/40 text-muted-foreground')}>
          {currency || '—'}
        </span>
      )}
      <input
        {...describedBy(id, error)}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass, 'tabular-nums')}
      />
    </div>
  )
}

/**
 * Fixes one record in a second drawer over the import one, so closing it lands back on the list;
 * saving re-checks the record on the server.
 */
export function EditRecordDrawer({
  config,
  batchId,
  record,
  name,
  onDone,
}: {
  config: ImportKindConfig
  batchId: string
  record: ImportRecord
  name: string
  onDone: (record: ImportRecord | null) => void
}) {
  const patch = usePatchImportRecord(batchId)
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      [...config.editable, ...(config.pickClient ? ['client_name'] : [])].map((field) => [
        field,
        displayValue(record.data[field]),
      ]),
    ),
  )
  const set = (field: string, value: string) =>
    setValues((current) => ({ ...current, [field]: value }))
  const toggles = config.toggles ?? []
  const dates = config.dates ?? []
  const amounts = config.amounts ?? {}
  // The currency is picked once, beside the record's first amount; the other amounts show its code.
  const pickers = new Map<string, string>()
  for (const [field, currency] of Object.entries(amounts))
    if (config.editable.includes(currency) && !pickers.has(currency)) pickers.set(currency, field)
  const save = () => {
    if (patch.isPending) return
    const changes = recordChanges(record.data, values, toggles)
    if (!Object.keys(changes).length) return onDone(null)
    patch.mutate(
      { recordId: record.id, data: changes },
      { onSuccess: (saved) => !Object.keys(saved.issues).length && onDone(saved) },
    )
  }

  return (
    <Sheet open onOpenChange={(next) => !next && onDone(null)}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(560px,calc(100vw-4rem))]! dark:bg-card"
      >
        <form
          noValidate
          aria-label={translate('editRecord')}
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
            <div className="grid min-w-0 gap-0.5">
              <SheetTitle className="text-lg font-semibold">{translate('editRecord')}</SheetTitle>
              <SheetDescription className="truncate text-body-sm text-muted-foreground">
                {name}
              </SheetDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('close')}
                  onClick={() => onDone(null)}
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translate('close')}</TooltipContent>
            </Tooltip>
          </header>

          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-5 sm:grid-cols-2">
            {config.editable.map((field) => {
              const id = `import-${record.id}-${field}`
              const error = record.issues[field]
              const label = config.fields[field] ?? field
              if (config.pickClient && field === 'client_id')
                return (
                  <ImportClientField
                    key={field}
                    id={id}
                    clientId={values.client_id ?? ''}
                    clientName={values.client_name ?? ''}
                    error={error}
                    onPick={(client) =>
                      setValues((current) => ({
                        ...current,
                        client_id: client.id,
                        client_name: client.name,
                      }))
                    }
                  />
                )
              if (toggles.includes(field))
                return (
                  <SwitchRow
                    key={field}
                    id={id}
                    label={label}
                    description={config.tips?.[field]}
                    checked={values[field] === translate('yes')}
                    onCheckedChange={(on) => set(field, on ? translate('yes') : translate('no4'))}
                    className="sm:col-span-2"
                  />
                )
              // The currency field of a record with amounts lives inside its first amount.
              if (Object.values(amounts).includes(field)) return null
              const currencyField = amounts[field]
              return (
                <FormField
                  key={field}
                  id={id}
                  label={label}
                  error={error}
                  tip={config.tips?.[field]}
                >
                  {dates.includes(field) ? (
                    <ImportDateField
                      id={id}
                      label={label}
                      value={values[field] ?? ''}
                      error={error}
                      onChange={(date) => set(field, date)}
                    />
                  ) : currencyField ? (
                    <ImportAmountField
                      id={id}
                      value={values[field] ?? ''}
                      currency={values[currencyField] ?? ''}
                      error={error ?? record.issues[currencyField]}
                      onChange={(amount) => set(field, amount)}
                      onCurrency={
                        pickers.get(currencyField) === field
                          ? (code) => set(currencyField, code)
                          : undefined
                      }
                    />
                  ) : (
                    <input
                      {...describedBy(id, error)}
                      value={values[field] ?? ''}
                      onChange={(event) => set(field, event.target.value)}
                      className={inputClass}
                    />
                  )}
                </FormField>
              )
            })}
            {record.duplicate && (
              <p className="text-caption text-muted-foreground sm:col-span-2">
                {translate('possibleDuplicate')}
                {record.duplicate.label} ({record.duplicate.reason}).
              </p>
            )}
            {patch.error && (
              <p role="alert" className="text-caption text-destructive sm:col-span-2">
                {errorMessage(patch.error)}
              </p>
            )}
          </div>

          <footer className="flex min-h-14 shrink-0 items-center justify-end gap-2 border-t px-5 py-2.5">
            <Button type="button" variant="ghost" onClick={() => onDone(null)}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={patch.isPending}>
              {translate('save2')}
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  )
}

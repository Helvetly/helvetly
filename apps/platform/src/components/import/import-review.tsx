'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowLeft, Check, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { inputClass } from '@/components/clients/fields'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  displayValue,
  IMPORT_KINDS,
  isSettled,
  recordChanges,
  recordsByKind,
  usePatchImportRecord,
  type CommitResult,
  type ImportKindConfig,
  type ImportRecord,
} from '@/lib/imports'

import { ImportClientField } from './import-client-field'

const rowName = (config: ImportKindConfig, record: ImportRecord, index: number) =>
  displayValue(record.data[config.labelKey ?? 'name']) ||
  translate('dynamicRow', { value1: index + 1 })
/** The drawer footer's Save submits this form. */
export const EDIT_FORM_ID = 'import-edit-record'
const issueId = (record: ImportRecord, field: string) => `${record.id}-${field}-issue`

/** An `auto` import's records, one table per kind under its own heading; one selection across them all. */
export function GroupedReview({
  records,
  selected,
  results,
  onSelect,
  onEdit,
}: {
  records: ImportRecord[]
  selected: ReadonlySet<string>
  results: ReadonlyMap<string, CommitResult>
  onSelect: (selected: Set<string>) => void
  onEdit: (id: string) => void
}) {
  const groups = recordsByKind(records)
  if (!groups.length)
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-body-sm text-muted-foreground">
        {translate('nothingToImportWasFoundInTheseFilesTry')}
      </p>
    )
  return (
    <div className="grid gap-5">
      {groups.map(({ kind, records: group }) => {
        const ids = new Set(group.map((record) => record.id))
        return (
          <section key={kind} aria-label={IMPORT_KINDS[kind].label} className="grid gap-2">
            <h3 className="text-body-sm font-medium">
              {IMPORT_KINDS[kind].label}{' '}
              <span className="font-normal text-muted-foreground tabular-nums">{group.length}</span>
            </h3>
            <ReviewTable
              config={IMPORT_KINDS[kind]}
              records={group}
              selected={selected}
              results={results}
              // The table selects within its kind; keep the other kinds' ticks.
              onSelect={(next) =>
                onSelect(new Set([...[...selected].filter((id) => !ids.has(id)), ...next]))
              }
              onEdit={onEdit}
            />
          </section>
        )
      })}
    </div>
  )
}

/** The records read from the files: tick the ones to create, fix the flagged ones first. */
export function ReviewTable({
  config,
  records,
  selected,
  results,
  onSelect,
  onEdit,
}: {
  config: ImportKindConfig
  records: ImportRecord[]
  selected: ReadonlySet<string>
  results: ReadonlyMap<string, CommitResult>
  onSelect: (selected: Set<string>) => void
  onEdit: (id: string) => void
}) {
  const open = records.filter((record) => !isSettled(record))
  const ticked = open.filter((record) => selected.has(record.id)).length
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    onSelect(next)
  }

  if (!records.length)
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
        {translate('no2')}
        {config.label.toLowerCase()}
        {translate('wereFoundInTheseFilesTryOtherFilesOr')}
      </p>
    )

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table
        aria-label={translate('recordsFound')}
        className="w-full min-w-[640px] text-left text-[13px]"
      >
        <thead className="border-b bg-muted/40 text-[12px] text-muted-foreground">
          <tr>
            <th scope="col" className="w-10 px-3 py-2">
              <Checkbox
                aria-label={translate('selectAll3')}
                disabled={!open.length}
                checked={ticked === 0 ? false : ticked === open.length ? true : 'indeterminate'}
                onCheckedChange={(on) =>
                  onSelect(on === true ? new Set(open.map((record) => record.id)) : new Set())
                }
              />
            </th>
            {config.columns.map((field) => (
              <th key={field} scope="col" className="px-2 py-2 font-medium">
                {config.fields[field]}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 font-medium">
              {translate('notes')}
            </th>
            <th scope="col" className="w-10 px-2 py-2">
              <span className="sr-only">{translate('edit')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((record, index) => {
            const name = rowName(config, record, index)
            const created = record.status === 'created'
            const skipped = record.status === 'skipped'
            const issues = Object.keys(record.issues)
            const otherIssues = issues.filter((field) => !config.columns.includes(field))
            const result = results.get(record.id)
            return (
              <tr
                key={record.id}
                className={cn('align-top', (created || skipped) && 'text-muted-foreground')}
              >
                <td className="px-3 py-2">
                  {created ? (
                    <Check
                      aria-label={translate('created3')}
                      className="size-4 text-success-solid"
                    />
                  ) : skipped ? null : (
                    <Checkbox
                      aria-label={translate('select', { name: name })}
                      aria-describedby={
                        issues.length
                          ? issues.map((field) => issueId(record, field)).join(' ')
                          : undefined
                      }
                      checked={selected.has(record.id)}
                      onCheckedChange={(on) => toggle(record.id, on === true)}
                    />
                  )}
                </td>
                {config.columns.map((field) => {
                  const value = displayValue(record.data[field])
                  return (
                    <td key={field} className="max-w-48 px-2 py-2">
                      <span className={cn('block truncate', !value && 'text-muted-foreground')}>
                        {value || '—'}
                      </span>
                      {record.issues[field] && (
                        <span
                          id={issueId(record, field)}
                          className="block text-[11.5px] text-destructive"
                        >
                          {record.issues[field]}
                        </span>
                      )}
                    </td>
                  )
                })}
                <td className="min-w-44 px-2 py-2">
                  <div className="grid justify-items-start gap-1">
                    {created && record.entity_id && (
                      <span className="flex items-center gap-1.5">
                        <Badge variant="secondary">{translate('created3')}</Badge>
                        <Link
                          href={config.entityHref(record.entity_id)}
                          className="text-[12px] underline underline-offset-2"
                        >
                          {translate('openAction')}
                        </Link>
                      </span>
                    )}
                    {skipped && <Badge variant="outline">{translate('skipped2')}</Badge>}
                    {record.duplicate && !created && !skipped && (
                      <Badge variant="outline" className="h-auto text-left whitespace-normal">
                        {translate('possibleDuplicate')}
                        {record.duplicate.label} ({record.duplicate.reason})
                      </Badge>
                    )}
                    {otherIssues.map((field) => (
                      <span
                        key={field}
                        id={issueId(record, field)}
                        className="text-[11.5px] text-destructive"
                      >
                        {config.fields[field] ?? field}: {record.issues[field]}
                      </span>
                    ))}
                    {record.status === 'failed' && record.error && (
                      <span className="text-[11.5px] text-destructive">
                        {record.error}
                        {(result?.error?.code === 'limit_reached' ||
                          result?.error?.code === 'feature_not_in_plan') && (
                          <>
                            {' '}
                            <Link
                              href="/settings/billing/plans"
                              className="underline underline-offset-2"
                            >
                              {translate('seePlans')}
                            </Link>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  {!created && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={translate('edit3', { name: name })}
                          onClick={() => onEdit(record.id)}
                        >
                          <Pencil />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{translate('edit')}</TooltipContent>
                    </Tooltip>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Fixes one record in place of the table; saving re-checks it on the server. */
export function EditRecord({
  config,
  batchId,
  record,
  onDone,
}: {
  config: ImportKindConfig
  batchId: string
  record: ImportRecord
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
  const toggles = config.toggles ?? []
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
    <form
      noValidate
      id={EDIT_FORM_ID}
      aria-label={translate('editRecord')}
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone(null)}>
          <ArrowLeft />
          {translate('backToTheList')}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {config.editable.map((field) => {
          const id = `import-${record.id}-${field}`
          const error = record.issues[field]
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
                label={config.fields[field] ?? field}
                description={config.tips?.[field]}
                checked={values[field] === translate('yes')}
                onCheckedChange={(on) =>
                  setValues((current) => ({
                    ...current,
                    [field]: on ? translate('yes') : translate('no4'),
                  }))
                }
                className="sm:col-span-2"
              />
            )
          return (
            <FormField
              key={field}
              id={id}
              label={config.fields[field] ?? field}
              error={error}
              tip={config.tips?.[field]}
            >
              <input
                {...describedBy(id, error)}
                value={values[field] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field]: event.target.value }))
                }
                className={inputClass}
              />
            </FormField>
          )
        })}
      </div>
      {record.duplicate && (
        <p className="text-[12.5px] text-muted-foreground">
          {translate('possibleDuplicate')}
          {record.duplicate.label} ({record.duplicate.reason}).
        </p>
      )}
      {patch.error && (
        <p role="alert" className="text-[12.5px] text-destructive">
          {errorMessage(patch.error)}
        </p>
      )}
    </form>
  )
}

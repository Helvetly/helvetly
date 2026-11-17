'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, FileText, Pencil } from 'lucide-react'
import Link from 'next/link'

import { translate } from '@/lib/i18n'
import {
  displayValue,
  DOCUMENT_TYPES,
  IMPORT_KINDS,
  isSettled,
  recordsByKind,
  type CommitResult,
  type ImportFile,
  type ImportKindConfig,
  type ImportRecord,
} from '@/lib/imports'

import { IssueChip, issuesId } from './import-issues'

export const rowName = (config: ImportKindConfig, record: ImportRecord, index: number) =>
  displayValue(record.data[config.labelKey ?? 'name']) ||
  translate('dynamicRow', { value1: index + 1 })

/**
 * An `auto` import's records, one section per document (file) with its records beneath, so each
 * document's rows show up as soon as that file is read; one selection across them all.
 */
export function GroupedReview({
  files,
  records,
  selected,
  results,
  reading,
  onSelect,
  onEdit,
}: {
  files: ImportFile[]
  records: ImportRecord[]
  selected: ReadonlySet<string>
  results: ReadonlyMap<string, CommitResult>
  /** More files are still being read: no records yet is not "nothing found". */
  reading: boolean
  onSelect: (selected: Set<string>) => void
  onEdit: (id: string) => void
}) {
  const documents = files
    .map((file) => ({ file, records: records.filter((record) => record.file_id === file.id) }))
    .filter((document) => document.records.length > 0)
  if (!documents.length)
    return reading ? null : (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-body-sm text-muted-foreground">
        {translate('nothingToImportWasFoundInTheseFilesTry')}
      </p>
    )
  return (
    <div className="grid gap-6">
      {documents.map(({ file, records: own }) => (
        <section key={file.id} aria-label={file.name} className="grid gap-2">
          <h3 className="flex items-center gap-2 text-body-sm font-medium">
            <FileText className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
            <span className="min-w-0 truncate">{file.name}</span>
            {file.document_type && file.document_type !== 'other' && (
              <Badge variant="secondary">{DOCUMENT_TYPES[file.document_type]}</Badge>
            )}
            <span className="font-normal text-muted-foreground">
              {translate('importDocumentRecords', { count: own.length })}
            </span>
          </h3>
          <div className="grid gap-3">
            {recordsByKind(own).map(({ kind, records: group }) => {
              const ids = new Set(group.map((record) => record.id))
              return (
                <ReviewTable
                  key={kind}
                  config={IMPORT_KINDS[kind]}
                  records={group}
                  selected={selected}
                  results={results}
                  // The table selects within its kind; keep the other ticks.
                  onSelect={(next) =>
                    onSelect(new Set([...[...selected].filter((id) => !ids.has(id)), ...next]))
                  }
                  onEdit={onEdit}
                />
              )
            })}
          </div>
        </section>
      ))}
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
                      aria-describedby={issues.length ? issuesId(record) : undefined}
                      checked={selected.has(record.id)}
                      onCheckedChange={(on) => toggle(record.id, on === true)}
                    />
                  )}
                </td>
                {config.columns.map((field) => {
                  const value = displayValue(record.data[field])
                  return (
                    <td key={field} className="max-w-48 px-2 py-2">
                      <span
                        className={cn(
                          'block truncate',
                          !value && 'text-muted-foreground',
                          record.issues[field] &&
                            'underline decoration-warning decoration-dotted underline-offset-4',
                        )}
                      >
                        {value || '—'}
                      </span>
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
                    {issues.length > 0 && !created && !skipped && (
                      <IssueChip
                        id={issuesId(record)}
                        config={config}
                        record={record}
                        onFix={() => onEdit(record.id)}
                      />
                    )}
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

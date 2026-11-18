'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, FileText, Pencil } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'

import { translate } from '@/lib/i18n'
import {
  displayValue,
  IMPORT_KINDS,
  isSettled,
  recordsByKind,
  type CommitResult,
  type ImportFile,
  type ImportKindConfig,
  type ImportRecord,
} from '@/lib/imports'

import { FileLine, FileProgress } from './import-files'
import { IssueChip, issuesId } from './import-issues'

export const rowName = (config: ImportKindConfig, record: ImportRecord, index: number) =>
  displayValue(record.data[config.labelKey ?? 'name']) ||
  translate('dynamicRow', { value1: index + 1 })

/**
 * Every file of the import with what was read from it right inside its card, so each document's rows show up as
 * soon as that file is read; one selection across them all. `config` names one kind (a kind's own import),
 * otherwise each file's records are grouped by kind.
 */
export function FileReview({
  files,
  records,
  config,
  selected,
  results,
  reading,
  onSelect,
  onEdit,
}: {
  files: ImportFile[]
  records: ImportRecord[]
  config?: ImportKindConfig | null
  selected: ReadonlySet<string>
  results: ReadonlyMap<string, CommitResult>
  /** More files are still being read: no records yet is not "nothing found". */
  reading: boolean
  onSelect: (selected: Set<string>) => void
  onEdit: (id: string) => void
}) {
  const perFile = new Map<string, ImportRecord[]>()
  for (const record of records)
    perFile.set(record.file_id, [...(perFile.get(record.file_id) ?? []), record])
  const counts = new Map([...perFile].map(([id, own]) => [id, own.length]))
  const open = records.filter((record) => !isSettled(record))
  const tickState = (group: ImportRecord[]) => {
    const ticked = group.filter((record) => selected.has(record.id)).length
    return ticked === 0 ? false : ticked === group.length ? true : 'indeterminate'
  }
  /** Ticks or unticks `group`, keeping every other tick. */
  const tick = (group: ImportRecord[], on: boolean) => {
    const next = new Set(selected)
    for (const record of group) {
      if (on) next.add(record.id)
      else next.delete(record.id)
    }
    onSelect(next)
  }
  const table = (kind: ImportKindConfig, group: ImportRecord[]) => {
    const ids = new Set(group.map((record) => record.id))
    return (
      <ReviewTable
        config={kind}
        records={group}
        selected={selected}
        results={results}
        // The table selects within itself; keep the other ticks.
        onSelect={(next) =>
          onSelect(new Set([...[...selected].filter((id) => !ids.has(id)), ...next]))
        }
        onEdit={onEdit}
        bare
      />
    )
  }
  if (config)
    return (
      <ReviewTable
        config={config}
        records={records}
        files={files}
        selected={selected}
        results={results}
        onSelect={onSelect}
        onEdit={onEdit}
      />
    )
  return (
    <div className="grid gap-3">
      <FileProgress
        files={files}
        recordsPerFile={counts}
        header={
          open.length > 0 && (
            <>
              <span className="grid w-4 shrink-0 place-items-center">
                <Checkbox
                  aria-label={translate('selectAllRows')}
                  checked={tickState(open)}
                  onCheckedChange={(on) => tick(open, on === true)}
                />
              </span>
              <span>
                {translate('importSelectedOfAll', {
                  count: open.filter((record) => selected.has(record.id)).length,
                  total: open.length,
                })}
              </span>
            </>
          )
        }
      >
        {(file) => {
          const own = perFile.get(file.id)
          if (!own?.length) return null
          return (
            <section aria-label={file.name} className="grid divide-y">
              {recordsByKind(own).map(({ kind, records: group }) => (
                <Fragment key={kind}>{table(IMPORT_KINDS[kind], group)}</Fragment>
              ))}
            </section>
          )
        }}
      </FileProgress>
      {!reading && !records.length && (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-body-sm text-muted-foreground">
          {translate('nothingToImportWasFoundInTheseFilesTry')}
        </p>
      )}
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
  files,
  bare = false,
}: {
  config: ImportKindConfig
  records: ImportRecord[]
  /**
   * The import's files, in order: each shows as one row (reading, waiting, failed) until its records replace it,
   * and a Document column names where each record came from.
   */
  files?: ImportFile[]
  selected: ReadonlySet<string>
  results: ReadonlyMap<string, CommitResult>
  onSelect: (selected: Set<string>) => void
  onEdit: (id: string) => void
  /** Inside a file's card: no frame of its own, only the card's. */
  bare?: boolean
}) {
  const open = records.filter((record) => !isSettled(record))
  const ticked = open.filter((record) => selected.has(record.id)).length
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    onSelect(next)
  }

  const fileOf = new Map(files?.map((file) => [file.id, file]))
  type Row = { record: ImportRecord } | { file: ImportFile }
  const rows: Row[] = files
    ? [
        ...files.flatMap((file): Row[] => {
          const own = records.filter((record) => record.file_id === file.id)
          return own.length ? own.map((record) => ({ record })) : [{ file }]
        }),
        ...records.filter((record) => !fileOf.has(record.file_id)).map((record) => ({ record })),
      ]
    : records.map((record) => ({ record }))
  // Document, the kind's columns, Notes and Edit: what a file's own row spans besides the checkbox.
  const span = config.columns.length + (files ? 3 : 2)

  if (!records.length && !files?.length)
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
        {translate('no2')}
        {config.label.toLowerCase()}
        {translate('wereFoundInTheseFilesTryOtherFilesOr')}
      </p>
    )

  return (
    <div className={cn('overflow-x-auto', !bare && 'rounded-lg border')}>
      <table
        aria-label={translate('recordsFound')}
        className="w-full min-w-[640px] text-left text-[13px]"
      >
        <thead className={cn('border-b text-[12px] text-muted-foreground', !bare && 'bg-muted/40')}>
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
            {files && (
              <th scope="col" className="px-2 py-2 font-medium">
                {translate('document')}
              </th>
            )}
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
          {rows.map((row) => {
            if ('file' in row)
              return (
                <tr key={row.file.id} data-status={row.file.status}>
                  <td colSpan={span + 1} className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <FileLine file={row.file} records={0} />
                    </div>
                  </td>
                </tr>
              )
            const { record } = row
            const name = rowName(config, record, records.indexOf(record))
            const source = fileOf.get(record.file_id)
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
                {files && (
                  <td className="max-w-44 px-2 py-2">
                    <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                      <FileText aria-hidden className="size-3.5 shrink-0" />
                      <span className="truncate">{source?.name ?? '—'}</span>
                    </span>
                  </td>
                )}
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

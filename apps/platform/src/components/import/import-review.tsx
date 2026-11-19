'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate, formatMoney } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Banknote,
  Check,
  FileText,
  Handshake,
  Link2,
  Package,
  Pencil,
  Receipt,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'

import { translate } from '@/lib/i18n'
import {
  displayValue,
  importFileUrl,
  IMPORT_KINDS,
  isExisting,
  isSettled,
  matchReason,
  recordsByKind,
  type CommitResult,
  type ImportFile,
  type ImportKind,
  type ImportKindConfig,
  type ImportRecord,
} from '@/lib/imports'

import { FileIcon, FileLine, FileProgress } from './import-files'
import { IssueChip, issuesId } from './import-issues'

/** Each kind's mark in a file's group header. */
const KIND_ICONS: Record<ImportKind, LucideIcon> = {
  clients: UsersRound,
  products: Package,
  invoices: FileText,
  engagements: Handshake,
  expenses: Receipt,
  payroll: Banknote,
}

export const rowName = (config: ImportKindConfig, record: ImportRecord, index: number) =>
  displayValue(record.data[config.labelKey ?? 'name']) ||
  translate('dynamicRow', { value1: index + 1 })

/**
 * Every file of the import with what was read from it right inside its card, so each document's rows show up as
 * soon as that file is read; one selection across them all. `config` names one kind (a kind's own import),
 * otherwise each file's records are grouped by kind.
 */
export function FileReview({
  batchId,
  files,
  records,
  config,
  selected,
  results,
  reading,
  onSelect,
  onEdit,
}: {
  batchId: string
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
  const existing = new Map([...perFile].map(([id, own]) => [id, own.filter(isExisting).length]))
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
      />
    )
  }
  if (config)
    return (
      <ReviewTable
        config={config}
        records={records}
        files={files}
        batchId={batchId}
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
        existingPerFile={existing}
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
            <section aria-label={file.name} className="grid gap-4 p-3">
              {recordsByKind(own).map(({ kind, records: group }) => {
                const Icon = KIND_ICONS[kind]
                const heading = `${file.id}-${kind}`
                return (
                  // One kind's rows (and their ticks) under a small header: icon, name, count.
                  <fieldset key={kind} aria-labelledby={heading} className="grid min-w-0 gap-1.5">
                    <h3
                      id={heading}
                      className="flex items-center gap-1.5 text-caption font-medium text-foreground"
                    >
                      <Icon aria-hidden className="size-3.5 stroke-[1.75] text-muted-foreground" />
                      {IMPORT_KINDS[kind].label}
                      <span className="rounded-full bg-muted px-1.5 text-muted-foreground tabular-nums">
                        {group.length}
                      </span>
                    </h3>
                    {table(IMPORT_KINDS[kind], group)}
                  </fieldset>
                )
              })}
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
  batchId,
}: {
  config: ImportKindConfig
  records: ImportRecord[]
  /**
   * The import's files, in order: each shows as one row (reading, waiting, failed) until its records replace it,
   * and a Document column names where each record came from.
   */
  files?: ImportFile[]
  /** The import the files belong to: their names open the uploaded file in a new tab. */
  batchId?: string
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
  const cells = config.cells
  // The columns, Notes and Edit (and Document without cells): what a file's own row spans besides the checkbox.
  const span = (cells?.length ?? config.columns.length + (files ? 1 : 0)) + 2
  /** A field as people read it: a date as a date, money with its currency. */
  const shown = (record: ImportRecord, field: string, money?: string) => {
    const value = displayValue(record.data[field])
    if (!value) return ''
    if (money) {
      const amount = Number(value)
      return Number.isFinite(amount)
        ? formatMoney(amount.toFixed(2), displayValue(record.data[money]))
        : value
    }
    return config.dates?.includes(field) && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? formatDate(value)
      : value
  }

  if (!records.length && !files?.length)
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
        {translate('no2')}
        {config.label.toLowerCase()}
        {translate('wereFoundInTheseFilesTryOtherFilesOr')}
      </p>
    )

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table
        aria-label={translate('recordsFound')}
        className="w-full min-w-[640px] text-left text-[13px]"
      >
        {/* Headers read as headers: small caps on a muted row, the values below in the foreground. */}
        <thead className="border-b bg-muted/50 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
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
            {cells?.map((cell) => (
              <th
                key={cell.main}
                scope="col"
                className={cn('px-2 py-2 font-medium', cell.align === 'end' && 'text-right')}
              >
                {cell.label}
              </th>
            ))}
            {!cells && files && (
              <th scope="col" className="px-2 py-2 font-medium">
                {translate('document')}
              </th>
            )}
            {!cells &&
              config.columns.map((field) => (
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
            // A client or product the import found in Helvetly: what refers to it links to the existing one.
            const linked = skipped && (record.kind === 'clients' || record.kind === 'products')
            const issues = Object.keys(record.issues)
            const result = results.get(record.id)
            return (
              <tr
                key={record.id}
                className={cn('align-middle', (created || skipped) && 'text-muted-foreground')}
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
                {cells?.map((cell, at) => {
                  const main = shown(record, cell.main, cell.money)
                  const sub = (cell.sub ?? []).map((field) => shown(record, field)).filter(Boolean)
                  return (
                    <td
                      key={cell.main}
                      className={cn('max-w-64 px-2 py-2', cell.align === 'end' && 'text-right')}
                    >
                      <span
                        className={cn(
                          'block truncate text-body-sm font-medium',
                          cell.money && 'tabular-nums',
                          !main && 'font-normal text-muted-foreground',
                          record.issues[cell.main] &&
                            'underline decoration-warning decoration-dotted underline-offset-4',
                        )}
                      >
                        {main || '—'}
                      </span>
                      <span
                        className={cn(
                          'flex items-center gap-1 text-caption text-muted-foreground',
                          cell.align === 'end' && 'justify-end',
                        )}
                      >
                        {at === 0 && source && (
                          <>
                            <FileIcon name={source.name} className="size-3" />
                            {batchId ? (
                              <a
                                href={importFileUrl(batchId, source.id)}
                                target="_blank"
                                rel="noreferrer"
                                className="max-w-40 truncate underline-offset-2 hover:text-foreground hover:underline"
                              >
                                {source.name}
                              </a>
                            ) : (
                              <span className="max-w-40 truncate">{source.name}</span>
                            )}
                            {sub.length > 0 && <span aria-hidden>·</span>}
                          </>
                        )}
                        <span className="truncate">{sub.join(' · ')}</span>
                      </span>
                    </td>
                  )
                })}
                {!cells && files && (
                  <td className="max-w-44 px-2 py-2">
                    <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                      {source && <FileIcon name={source.name} className="size-3.5" />}
                      <span className="truncate">{source?.name ?? '—'}</span>
                    </span>
                  </td>
                )}
                {!cells &&
                  config.columns.map((field) => {
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
                    {skipped && !linked && <Badge variant="outline">{translate('skipped2')}</Badge>}
                    {!created &&
                      !skipped &&
                      config.badges
                        ?.filter((field) => record.data[field] === true)
                        .map((field) => (
                          <Badge key={field} variant="secondary">
                            {config.fields[field]}
                          </Badge>
                        ))}
                    {record.duplicate && isExisting(record) && (
                      <Existing
                        config={config}
                        duplicate={record.duplicate}
                        linked={linked}
                        hint={!skipped && !selected.has(record.id)}
                      />
                    )}
                    {record.duplicate && !record.duplicate.id && !created && !skipped && (
                      <Badge variant="outline" className="h-auto text-left whitespace-normal">
                        {translate('possibleDuplicate')}
                        {record.duplicate.label} ({matchReason(record.duplicate.reason)})
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
                    {record.status === 'failed' && record.error && issues.length === 0 && (
                      <span className="rounded-md bg-destructive-surface px-2 py-0.5 text-caption text-destructive">
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

/**
 * The record Helvetly already has, which opens: `linked` (a client or product the import refers to, not created
 * again), else already there; `hint` says ticking it imports it anyway.
 */
function Existing({
  config,
  duplicate,
  linked,
  hint,
}: {
  config: ImportKindConfig
  duplicate: NonNullable<ImportRecord['duplicate']>
  linked: boolean
  hint: boolean
}) {
  const why = [matchReason(duplicate.reason)]
  if (linked) why.push(translate('importLinkedNotCreated'))
  else if (hint) why.push(translate('importTickAnyway'))
  return (
    <span className="grid justify-items-start gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="h-auto text-left whitespace-normal">
          {linked && <Link2 aria-hidden />}
          {translate(linked ? 'importMatches' : 'importAlreadyIn', { label: duplicate.label })}
        </Badge>
        <Link
          href={config.entityHref(duplicate.id)}
          className="text-[12px] underline underline-offset-2"
        >
          {translate('openAction')}
        </Link>
      </span>
      <span className="text-caption text-muted-foreground">{why.join(' · ')}</span>
    </span>
  )
}

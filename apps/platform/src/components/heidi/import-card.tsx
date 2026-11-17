'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { cn } from '@helvetly/ui/lib/utils'
import { AlertTriangle, Check, CheckCircle2, Copy, Loader2, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { ImportConflicts, type Conflict } from '@/components/import/import-conflicts'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  commitSummary,
  conflictsOf,
  defaultSelection,
  displayValue,
  DOCUMENT_TYPES,
  foundSummary,
  IMPORT_KINDS,
  isSettled,
  recordsByKind,
  useCommitImport,
  useImportBatch,
  type CommitResult,
  type ImportKindConfig,
  type ImportRecord,
  type Resolution,
} from '@/lib/imports'

/** One line under a record's name: what tells it apart at a glance. */
export function recordDetail(record: ImportRecord) {
  const value = (field: string) => displayValue(record.data[field])
  const money = (amount: string) => (amount ? `${value('currency')} ${amount}`.trim() : '')
  const parts = {
    clients: [value('city'), value('email')],
    products: [money(value('unit_price'))],
    invoices: [value('client_name'), value('issue_date'), money(value('total'))],
    engagements: [value('client_name'), value('start_date')],
    expenses: [value('document_date'), money(value('amount'))],
    payroll: [value('period_start'), money(value('gross'))],
  }[record.kind]
  return parts.filter(Boolean).join(' · ')
}

/**
 * An import Heidi started from the chat's files: it follows the reading, says what each file is and what was found,
 * and lets the person tick and create the records right here. Fixing a field opens the full review in Documents.
 */
export function ImportCard({ batchId }: { batchId: string }) {
  const batch = useImportBatch(batchId)
  const commit = useCommitImport('auto', batchId)
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [results, setResults] = useState<ReadonlyMap<string, CommitResult>>(new Map())
  const [conflicts, setConflicts] = useState<Conflict[]>([])

  if (batch.error) return <InlineError className="mt-2">{errorMessage(batch.error)}</InlineError>
  if (!batch.data)
    return (
      <Loader2 aria-label={translate('loadingTheImport')} className="mt-2 size-4 animate-spin" />
    )

  const { files, records } = batch.data
  const reading = batch.data.status === 'extracting'
  const read = files.filter((file) => file.status === 'done' || file.status === 'failed').length
  const open = records.filter((record) => !isSettled(record))
  const selected = picked ?? defaultSelection(records)
  const chosen = open.filter((record) => selected.has(record.id)).map((record) => record.id)
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setPicked(next)
  }
  const run = (recordIds: string[], resolutions?: Record<string, Resolution>) =>
    commit.mutate(
      { recordIds, resolutions },
      {
        onSuccess: (answer) => {
          const merged = new Map(results)
          for (const result of answer.results) merged.set(result.id, result)
          setResults(merged)
          setConflicts(conflictsOf(answer.results))
          const done = new Set(
            answer.results
              .filter((result) => result.status === 'created' || result.status === 'skipped')
              .map((result) => result.id),
          )
          setPicked(new Set([...selected].filter((id) => !done.has(id))))
        },
      },
    )

  return (
    <section
      aria-label={translate('import5')}
      className="mt-2 grid gap-3 rounded-xl border bg-card px-3.5 py-3 text-body-sm"
    >
      <ul aria-label={translate('files')} className="grid gap-1">
        {files.map((file) => (
          <li key={file.id} className="flex items-start gap-2">
            {file.status === 'failed' ? (
              <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            ) : file.status === 'done' ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success-solid" />
            ) : (
              <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{file.name}</span>
              <span
                className={cn(
                  'block text-caption',
                  file.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {file.status === 'failed'
                  ? (file.error ?? translate('couldNotBeRead'))
                  : file.document_type
                    ? DOCUMENT_TYPES[file.document_type]
                    : translate('reading2')}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {reading ? (
        <output className="block text-muted-foreground">
          {translate('importReadProgress', { read, total: files.length })}
        </output>
      ) : records.length === 0 ? (
        <output className="block text-muted-foreground">
          {translate('nothingToImportWasFoundTryClearerCopiesOr')}
        </output>
      ) : (
        <>
          <output className="block font-medium">
            {translate('importFoundSummary', { summary: foundSummary(records) })}
          </output>
          {recordsByKind(records).map(({ kind, records: group }) => (
            <div key={kind} className="grid gap-1.5">
              <h4 className="text-caption font-medium text-muted-foreground">
                {IMPORT_KINDS[kind].label}
              </h4>
              <ul className="grid gap-1.5">
                {group.map((record) => (
                  <RecordRow
                    key={record.id}
                    record={record}
                    checked={selected.has(record.id)}
                    result={results.get(record.id)}
                    onCheck={(on) => toggle(record.id, on)}
                  />
                ))}
              </ul>
            </div>
          ))}
          {commit.error && <InlineError>{errorMessage(commit.error)}</InlineError>}
          <div className="flex flex-wrap items-center gap-2">
            {open.length > 0 && (
              <Button
                size="sm"
                disabled={!chosen.length || commit.isPending}
                onClick={() => run(chosen)}
              >
                {commit.isPending
                  ? translate('importing')
                  : translate('import3', { length: chosen.length })}
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href="/documents?import=1">
                {open.length ? translate('reviewAndEdit') : translate('openImport')}
              </Link>
            </Button>
            {results.size > 0 && (
              <span className="text-caption text-muted-foreground">
                {commitSummary([...results.values()])}
              </span>
            )}
          </div>
        </>
      )}

      {conflicts.length > 0 && (
        <ImportConflicts
          key={conflicts.map((entry) => entry.id).join()}
          config={
            IMPORT_KINDS[
              records.find((record) => record.id === conflicts[0]?.id)?.kind ?? 'invoices'
            ]
          }
          records={records}
          conflicts={conflicts}
          pending={commit.isPending}
          onConfirm={(resolutions) =>
            run(
              conflicts.map((entry) => entry.id),
              resolutions,
            )
          }
          onCancel={() => setConflicts([])}
        />
      )}
    </section>
  )
}

/** A found record: tick it to create it; what needs a look (a problem, a possible duplicate) shows under it. */
function RecordRow({
  record,
  checked,
  result,
  onCheck,
}: {
  record: ImportRecord
  checked: boolean
  result: CommitResult | undefined
  onCheck: (on: boolean) => void
}) {
  const config: ImportKindConfig = IMPORT_KINDS[record.kind]
  const name = displayValue(record.data[config.labelKey ?? 'name']) || translate('unnamed')
  const issues = Object.entries(record.issues)
  const failed = result?.error?.message ?? record.error
  return (
    <li className="flex items-start gap-2">
      {record.status === 'created' ? (
        <Check
          aria-label={translate('created3')}
          className="mt-0.5 size-4 shrink-0 text-success-solid"
        />
      ) : record.status === 'skipped' ? (
        <span className="size-4 shrink-0" />
      ) : (
        <Checkbox
          aria-label={translate('import4', { name: name })}
          checked={checked}
          onCheckedChange={(on) => onCheck(on === true)}
          className="mt-0.5"
        />
      )}
      <div
        className={cn(
          'grid min-w-0 flex-1',
          record.status === 'skipped' && 'text-muted-foreground',
        )}
      >
        {record.status === 'created' && record.entity_id ? (
          <Link
            href={config.entityHref(record.entity_id)}
            className="truncate underline underline-offset-2"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate">
            {name}
            {record.status === 'skipped' && translate('skipped3')}
          </span>
        )}
        <span className="truncate text-caption text-muted-foreground">{recordDetail(record)}</span>
        {record.duplicate && record.status !== 'created' && (
          <span className="flex items-start gap-1 text-caption text-warning">
            <Copy className="mt-0.5 size-3 shrink-0" />
            {translate('importDuplicate', {
              label: record.duplicate.label,
              reason: record.duplicate.reason,
            })}
          </span>
        )}
        {record.status !== 'created' &&
          issues.map(([field, message]) => (
            <span key={field} className="flex items-start gap-1 text-caption text-destructive">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {config.fields[field] ? `${config.fields[field]}: ` : ''}
              {message}
            </span>
          ))}
        {failed && record.status === 'failed' && !issues.length && (
          <span className="text-caption text-destructive">{failed}</span>
        )}
      </div>
    </li>
  )
}

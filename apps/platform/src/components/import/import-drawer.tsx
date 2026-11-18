'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Loader2, Play, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { isAIConsentRequired, useAIApproval } from '@/components/ai/ai-approval'
import { FeatureLockNotice, useFeatureLock } from '@/components/billing/feature-lock'
import { errorMessage } from '@/lib/api'
import { usageKey } from '@/lib/heidi'
import { translate } from '@/lib/i18n'
import {
  commitSummary,
  conflictsOf,
  defaultSelection,
  foundSummary,
  IMPORT_KINDS,
  importProblem,
  readsWithAI,
  isClean,
  isSettled,
  resumable,
  useCommitImport,
  useDiscardImport,
  useImportBatch,
  useImportBatches,
  useUploadImport,
  type CommitResult,
  type ImportTarget,
  type Resolution,
} from '@/lib/imports'

import { CloseImportedMonths } from './close-imported-months'
import { clearHandOff, peekHandOff } from './hand-off'
import { ImportConflicts, type Conflict } from './import-conflicts'
import { EditRecordDrawer } from './import-edit-drawer'
import { DropZone, ImportSteps, ReadingProgress } from './import-files'
import { IssueSummary } from './import-issues'
import { FileReview, rowName } from './import-review'

/**
 * Upload files, let the AI read them, review the records and create the chosen ones: one sheet whose
 * content follows the batch. Closing keeps the batch; the next open offers to continue it.
 */
export function ImportDrawer({
  kind,
  onClose,
  onCreated,
}: {
  kind: ImportTarget
  onClose: () => void
  /** After a commit that created records: what the batch has created so far. */
  onCreated?: (summary: string) => void
}) {
  // `auto`: the AI works out what each file is, and the review shows each kind's records under its own heading.
  const config = kind === 'auto' ? null : IMPORT_KINDS[kind]
  const noun = config ? config.label.toLowerCase() : 'records'
  const [files, setFiles] = useState(() => peekHandOff(kind))
  const aiLock = useFeatureLock('ai_import')
  // payroll files are parsed, not read by the AI
  const lock = kind === 'payroll' ? null : aiLock
  const [batchId, setBatchId] = useState<string | null>(null)
  // Set once the person chose: continue the unfinished batch, or start over.
  const [fresh, setFresh] = useState(false)
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [results, setResults] = useState<ReadonlyMap<string, CommitResult>>(new Map())
  const [summary, setSummary] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  useEffect(clearHandOff, [])

  const list = useImportBatches(kind)
  const batch = useImportBatch(batchId)
  const upload = useUploadImport(kind)
  const commit = useCommitImport(kind, batchId ?? '')
  const discard = useDiscardImport(kind)

  const records = batch.data?.records ?? []
  const open = records.filter((record) => !isSettled(record))
  const selected = picked ?? defaultSelection(records)
  const chosen = open.filter((record) => selected.has(record.id)).map((record) => record.id)
  const resume = !fresh && batchId === null ? resumable(list.data ?? []) : null
  const editingRecord = records.find((record) => record.id === editing)

  const queryClient = useQueryClient()
  const { ensure } = useAIApproval()
  const asking = useRef(false)
  // Reading with AI waits for the person's approval; Not now keeps the chosen files and sends nothing.
  const read = async () => {
    if (asking.current || upload.isPending) return
    asking.current = true
    const approved = !readsWithAI(kind) || (await ensure())
    asking.current = false
    if (!approved) return
    upload.mutate(files, {
      onSuccess: (created) => {
        setBatchId(created.id)
        setFresh(true)
        setFiles([])
      },
      // Approval withdrawn elsewhere: the next try asks again instead of trusting a stale answer.
      onError: (error) => {
        if (isAIConsentRequired(error)) void queryClient.invalidateQueries({ queryKey: usageKey })
      },
    })
  }
  const reset = () => {
    setBatchId(null)
    setFresh(true)
    setPicked(null)
    setEditing(null)
    setResults(new Map())
    setSummary(null)
    setConflicts([])
    upload.reset()
    commit.reset()
  }
  const runDiscard = () => {
    if (batchId) discard.mutate(batchId, { onSuccess: reset })
  }
  const runCommit = (recordIds: string[], resolutions?: Record<string, Resolution>) =>
    commit.mutate(
      { recordIds, resolutions },
      {
        onSuccess: (answer) => {
          const merged = new Map(results)
          for (const result of answer.results) merged.set(result.id, result)
          setResults(merged)
          const text = commitSummary([...merged.values()])
          setSummary(text)
          if (answer.results.some((result) => result.status === 'created')) onCreated?.(text)
          setConflicts(conflictsOf(answer.results))
          const settled = new Set(
            answer.results
              .filter((result) => result.status === 'created' || result.status === 'skipped')
              .map((result) => result.id),
          )
          setPicked(new Set([...selected].filter((id) => !settled.has(id))))
        },
      },
    )

  const recordsPerFile = new Map<string, number>()
  for (const record of records)
    recordsPerFile.set(record.file_id, (recordsPerFile.get(record.file_id) ?? 0) + 1)
  const filesDone = batch.data?.files.filter(
    (file) => file.status === 'done' || file.status === 'failed',
  ).length

  let body: ReactNode
  let status: ReactNode = null
  let error: string | null = null
  let actions: ReactNode = null
  if (batchId === null || upload.isPending) {
    body = (
      <div className="grid gap-4">
        {resume && !upload.isPending && (
          <Callout
            tone="info"
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => setFresh(true)}>
                  <RotateCcw />
                  {translate('startANewOne')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setBatchId(resume.id)
                    setFresh(true)
                  }}
                >
                  <Play />
                  {translate('importContinueShort')}
                </Button>
              </>
            }
          >
            {translate('youHaveAnUnfinishedImportFrom')}
            {formatDate(resume.created_at)}.
          </Callout>
        )}
        <FeatureLockNotice lock={lock} kept={translate('importsAlreadyReadStayOpenForReview')} />
        {upload.error && <Problem error={upload.error} onRetry={() => void read()} />}
        <DropZone files={files} disabled={upload.isPending || Boolean(lock)} onChange={setFiles} />
        {files.length === 0 && (
          <ImportSteps
            suggests={
              config ? translate('importSuggestions', { noun }) : translate('importStepReadText')
            }
          />
        )}
      </div>
    )
    status = upload.isPending
      ? translate('uploading3')
      : files.length
        ? translate('dynamicChosen', {
            length: files.length,
            value2: files.length === 1 ? translate('dynamicFile') : translate('dynamicFiles3'),
          })
        : translate('noFilesChosenYet')
    actions = (
      <Button
        disabled={!files.length || upload.isPending || Boolean(lock)}
        onClick={() => void read()}
      >
        {upload.isPending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Sparkles />
        )}
        {upload.isPending ? translate('uploading3') : translate('readFiles')}
      </Button>
    )
  } else if (!batch.data) {
    body = batch.error ? (
      <Problem error={batch.error} onRetry={() => void batch.refetch()} />
    ) : (
      <Loader className="min-h-52" />
    )
  } else {
    const reading = batch.data.status === 'extracting'
    // Only an import that went through: nothing failed or waits on a conflict.
    const allCreated =
      results.size > 0 &&
      [...results.values()].every((r) => r.status === 'created' || r.status === 'skipped')
    body = (
      <div className="grid gap-4">
        {reading && <ReadingProgress done={filesDone ?? 0} total={batch.data.files.length} />}
        {reading && records.length > 0 && (
          <p className="text-caption text-muted-foreground">{translate('importMoreComing')}</p>
        )}
        <IssueSummary
          batchId={batch.data.id}
          records={records}
          onEdit={setEditing}
          onFixed={(saved) =>
            setPicked(
              (current) =>
                new Set([...(current ?? selected), ...saved.filter(isClean).map((r) => r.id)]),
            )
          }
        />
        {open.some((record) => record.data.issued_elsewhere === true) && <DeclaredVatNote />}
        {!reading && open.length === 0 && allCreated && (
          <CloseImportedMonths
            created={records.filter((record) => results.get(record.id)?.status === 'created')}
          />
        )}
        <FileReview
          files={batch.data.files}
          config={config}
          reading={reading}
          records={records}
          selected={selected}
          results={results}
          onSelect={setPicked}
          onEdit={setEditing}
        />
      </div>
    )
    status = reading
      ? translate('readOfFiles', { filesDone: filesDone, length: batch.data.files.length })
      : (summary ??
        (config || !records.length
          ? translate('ofSelected', { length: chosen.length, value2: open.length })
          : translate('importFoundSelected', {
              summary: foundSummary(records),
              count: chosen.length,
            })))
    error = commit.error ? errorMessage(commit.error) : null
    actions = (
      <>
        <Button
          variant={open.length || reading ? 'destructive-ghost' : 'outline'}
          disabled={discard.isPending || commit.isPending}
          onClick={() => (open.length || reading ? setConfirmDiscard(true) : runDiscard())}
        >
          {open.length || reading ? (
            <>
              <Trash2 />
              {translate('discard2')}
            </>
          ) : (
            translate('startANewImport')
          )}
        </Button>
        {open.length > 0 || !summary ? (
          <Button
            disabled={reading || !chosen.length || commit.isPending}
            onClick={() => runCommit(chosen)}
          >
            {commit.isPending
              ? translate('importing')
              : translate('import3', { length: chosen.length })}
          </Button>
        ) : (
          <Button onClick={onClose}>{translate('done')}</Button>
        )}
      </>
    )
  }

  return (
    <Sheet open onOpenChange={(next) => !next && !upload.isPending && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(1180px,calc(100vw-4rem))]! dark:bg-card"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 md:px-8">
          <div className="grid min-w-0 gap-0.5">
            <SheetTitle className="truncate text-lg font-semibold">
              {config ? translate('importKind', { noun }) : translate('importDocuments')}
            </SheetTitle>
            <SheetDescription className="text-[13px] text-pretty text-muted-foreground">
              {config
                ? translate('fromSpreadsheetsPDFsPhotosOrWordFilesReadBy')
                : translate('importAutoDescription')}
            </SheetDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate('close')}
                disabled={upload.isPending}
                onClick={onClose}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('close')}</TooltipContent>
          </Tooltip>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">{body}</div>

        <footer className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-t px-5 py-2.5 md:px-7">
          <p
            role={error ? 'alert' : 'status'}
            className={cn(
              'min-w-0 flex-1 truncate text-[13px]',
              error ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {error ?? status}
          </p>
          {actions}
        </footer>

        {conflicts.length > 0 && (
          <ImportConflicts
            key={conflicts.map((entry) => entry.id).join()}
            config={
              config ??
              IMPORT_KINDS[
                records.find((record) => record.id === conflicts[0]?.id)?.kind ?? 'invoices'
              ]
            }
            records={records}
            conflicts={conflicts}
            pending={commit.isPending}
            onConfirm={(resolutions) =>
              runCommit(
                conflicts.map((entry) => entry.id),
                resolutions,
              )
            }
            onCancel={() => setConflicts([])}
          />
        )}

        {editingRecord && (
          <EditRecordDrawer
            key={editingRecord.id}
            config={IMPORT_KINDS[editingRecord.kind]}
            batchId={batchId ?? ''}
            record={editingRecord}
            fileName={batch.data?.files.find((file) => file.id === editingRecord.file_id)?.name}
            name={rowName(
              IMPORT_KINDS[editingRecord.kind],
              editingRecord,
              records.indexOf(editingRecord),
            )}
            onDone={(saved) => {
              setEditing(null)
              if (saved && isClean(saved))
                setPicked((current) => new Set([...(current ?? selected), saved.id]))
            }}
          />
        )}

        {confirmDiscard && (
          <ConfirmDialog
            tone="destructive"
            title={translate('discardThisImport')}
            body={translate('theNotCreatedYetAreDroppedCreatedAndThe', {
              noun: noun,
              value2: noun,
            })}
            confirmLabel={translate('discard')}
            cancelLabel={translate('keep')}
            onDecide={(approved) => {
              setConfirmDiscard(false)
              if (approved) runDiscard()
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Invoices issued elsewhere count in the VAT return: months the old system declared must be closed first. */
function DeclaredVatNote() {
  return (
    <Callout role="note" tone="warning" title={translate('alreadyDeclaredForVAT')}>
      <p>
        {translate('invoicesIssuedElsewhereCountInHelvetlySVATReturn')}{' '}
        <Link href="/books" className="underline underline-offset-2">
          {translate('booksClosing')}
        </Link>{' '}
        {translate('firstInvoicesDatedInAClosedMonthAreNot')}
      </p>
    </Callout>
  )
}

/** Why the upload or the read failed, and the one thing that helps. */
function Problem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const problem = importProblem(error)
  return (
    <div
      role="alert"
      className="grid gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-[13px] dark:bg-destructive/20"
    >
      <p className="flex items-center gap-2 font-medium text-destructive">
        <AlertCircle className="size-4 shrink-0" /> {problem.title}
      </p>
      <p className="text-pretty text-foreground">{problem.message}</p>
      {problem.kind === 'consent' && (
        <Button size="sm" className="w-fit" onClick={onRetry}>
          {translate('aiConsentRequiredAction')}
        </Button>
      )}
      {problem.kind === 'plan' && (
        <Button asChild size="sm" variant="outline" className="w-fit">
          <Link href="/settings/billing/plans">{translate('seePlans')}</Link>
        </Button>
      )}
      {problem.kind === 'retry' && (
        <Button size="sm" variant="outline" className="w-fit" onClick={onRetry}>
          {translate('tryAgain')}
        </Button>
      )}
    </div>
  )
}

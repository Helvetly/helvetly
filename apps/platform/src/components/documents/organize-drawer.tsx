'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Switch } from '@helvetly/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Circle, CircleCheck, Info, LoaderCircle, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useAIApproval } from '@/components/ai/ai-approval'
import { FileIcon } from '@/components/import/import-files'
import { errorMessage } from '@/lib/api'
import {
  docsApi,
  refreshDocuments,
  useFolders,
  type DocFile,
  type OrganizeProposal,
  type StagedFile,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { pathLabel } from '@/lib/system-folders'

import { FolderPathInput, folderEntries, folderProblem } from './folder-combobox'
import { proposalFacts } from './proposal-facts'

type Row = OrganizeProposal & { folderInput: string }

/** Files of a staged upload to place: proposed a few at a time (to show progress), then filed all at once. */
export type StagedBatch = {
  batchId: string
  folderId: string | null
  files: StagedFile[]
}

/** Staged files asked about per request, so the drawer can show each one's progress. */
export const STAGED_CHUNK = 5

/** Where an applied row's file went: its proposed path; null for the rows left out (the batch's folder). */
export type StagedFiled = { documents: DocFile[]; paths: Record<string, string> }

/** A path as people read it: "Invoices › 2025", or "Top level". */
export const readablePath = (path: string | null) =>
  path ? pathLabel(path).split('/').join(' › ') : translate('organizeTopLevel')

/**
 * Organize with AI: Heidi looks at the documents, unsorted ones first, and proposes a folder (new ones too, like
 * "Invoices/2025") and tags for each, re-checking where the sorted ones sit. Nothing moves until the person ticks
 * rows and applies them; the move can be undone from the toast.
 */
export function OrganizeDrawer({
  folderId,
  staged,
  onApplied,
  onClose,
}: {
  /** Limit to this folder's files and subfolders; none: the whole library. */
  folderId?: string | null
  /** AI smart grouping of a staged upload instead of the stored files: analysed at once, applied by filing it. */
  staged?: StagedBatch
  onApplied?: (filed: StagedFiled) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { ensure } = useAIApproval()
  const folders = useFolders().data
  const entries = useMemo(() => folderEntries(folders ?? []), [folders])
  const existing = useMemo(() => new Set(entries.map(({ path }) => path.toLowerCase())), [entries])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [considered, setConsidered] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [showKept, setShowKept] = useState(false)

  const [analysed, setAnalysed] = useState<Set<string>>(new Set())
  // A staged upload's answers so far, kept across a retry after an error, which goes on from there.
  const answered = useRef<{ proposals: OrganizeProposal[]; considered: number }>({
    proposals: [],
    considered: 0,
  })
  const analyse = useMutation({
    mutationFn: async () => {
      if (!staged) return (await docsApi.organize(folderId ?? undefined)).data
      const done = new Set(answered.current.proposals.map((proposal) => proposal.document_id))
      const left = staged.files.filter((entry) => !done.has(entry.id)).map((entry) => entry.id)
      const chunks = Array.from({ length: Math.ceil(left.length / STAGED_CHUNK) }, (_, i) =>
        left.slice(i * STAGED_CHUNK, (i + 1) * STAGED_CHUNK),
      )
      // One request at a time: the workspace's AI pool takes one call at once, and each answer shows progress.
      await chunks.reduce(
        (previous, ids) =>
          previous.then(async () => {
            const result = (await docsApi.stagedAnalyze(staged.batchId, ids, staged.folderId)).data
            answered.current = {
              proposals: [...answered.current.proposals, ...result.proposals],
              considered: answered.current.considered + result.considered,
            }
            setAnalysed((current) => new Set([...current, ...ids]))
          }),
        Promise.resolve(),
      )
      return answered.current
    },
    onSuccess: (result) => {
      const next = result.proposals.map((proposal) => ({
        ...proposal,
        folderInput: proposal.folder,
      }))
      setRows(next)
      setConsidered(result.considered)
      setPicked(new Set(next.filter((row) => row.change).map((row) => row.document_id)))
    },
  })
  const started = useRef(false)
  useEffect(() => {
    // The person chose AI smart grouping already: no second start button.
    if (staged && !started.current) {
      started.current = true
      analyse.mutate()
    }
  }, [staged, analyse])
  const itemsOf = (items: Row[]) =>
    items.map((row) => ({
      document_id: row.document_id,
      folder: row.folderInput.trim().replace(/^\/+|\/+$/g, ''),
      tags: row.tags,
    }))
  const file = useMutation({
    mutationFn: async (items: Row[]) => {
      if (!staged) throw new Error('Filing needs a staged upload.')
      const chosen = itemsOf(items)
      const result = (await docsApi.stagedConfirm(staged.batchId, staged.folderId, chosen)).data
      return {
        documents: result.documents,
        paths: Object.fromEntries(chosen.map((item) => [item.document_id, item.folder])),
      }
    },
    onSuccess: (filed) => {
      refreshDocuments(queryClient)
      onApplied?.(filed)
    },
  })
  const apply = useMutation({
    mutationFn: async (items: Row[]) => (await docsApi.organizeApply(itemsOf(items))).data,
    onSuccess: (result) => {
      refreshDocuments(queryClient)
      onClose()
      toast.success(translate('organizeApplied', { count: result.moved }), {
        action: {
          label: translate('undo'),
          onClick: () =>
            void docsApi
              .organizeUndo(result.undo)
              .then(() => {
                refreshDocuments(queryClient)
                toast.success(translate('organizeUndone'))
              })
              .catch((error: unknown) => toast.error(errorMessage(error))),
        },
      })
    },
  })

  const start = async () => {
    if (!(await ensure())) return
    analyse.mutate()
  }
  const changes = rows?.filter((row) => row.change) ?? []
  const kept = rows?.filter((row) => !row.change) ?? []
  // A staged file always lands somewhere: every row is shown, unticked ones go to the folder the person was in.
  const shown = showKept || staged ? (rows ?? []) : changes
  const chosen = (rows ?? []).filter((row) => picked.has(row.document_id))
  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const tick = shown.filter((row) => picked.has(row.document_id)).length
  const setFolder = (id: string, value: string) =>
    setRows(
      (current) =>
        current &&
        current.map((row) => (row.document_id === id ? { ...row, folderInput: value } : row)),
    )
  const removeTag = (id: string, tag: string) =>
    setRows(
      (current) =>
        current &&
        current.map((row) =>
          row.document_id === id
            ? { ...row, tags: row.tags.filter((entry) => entry !== tag) }
            : row,
        ),
    )

  /** A row's proposed folder (editable) and tags (removable), with the reason. */
  const proposed = (row: Row) => {
    const problem = folderProblem(row.folderInput, existing)
    return (
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <FolderPathInput
              entries={entries}
              value={row.folderInput}
              label={translate('organizeFolderFor', { name: row.name })}
              invalid={problem !== null}
              onChange={(path) => setFolder(row.document_id, path)}
            />
          </div>
        </div>
        {problem && <p className="pl-1 text-caption text-destructive">{problem}</p>}
        <div className="flex flex-wrap items-center gap-1">
          {row.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 rounded-full bg-muted py-0.5 pr-1 pl-2 text-caption"
            >
              {tag}
              <button
                type="button"
                aria-label={translate('organizeRemoveTag', { tag })}
                onClick={() => removeTag(row.document_id, tag)}
                className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
          {row.reason && !staged && (
            <span className="ml-1 text-caption text-pretty text-muted-foreground">
              {row.reason}
            </span>
          )}
        </div>
      </div>
    )
  }

  /** A staged row's findings: the kind as a chip, the client and the year, the reason behind an info icon. */
  const facts = (row: Row) => {
    const { kind, client, year } = proposalFacts({ folder: row.folderInput, tags: row.tags })
    return (
      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-caption text-muted-foreground">
        {kind && (
          <span className="rounded-full bg-heidi-soft px-2 py-0.5 font-medium text-heidi">
            {kind}
          </span>
        )}
        {client && <span>{client}</span>}
        {year && <span>{year}</span>}
        {row.reason && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={translate('stagedWhy', { name: row.name })}
                className="grid size-5 place-items-center rounded-full hover:bg-muted hover:text-foreground"
              >
                <Info aria-hidden className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{row.reason}</TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }

  /** While a staged upload is analysed: each file, waiting, being looked at or done. */
  const progress = (files: StagedFile[]) => {
    const current = new Set(
      files
        .filter((entry) => !analysed.has(entry.id))
        .slice(0, STAGED_CHUNK)
        .map((entry) => entry.id),
    )
    return (
      <div className="grid gap-3">
        <p className="text-body-sm text-muted-foreground" aria-live="polite">
          {translate('stagedAnalysing', { done: analysed.size, total: files.length })}
        </p>
        <ul
          aria-label={translate('stagedFiles')}
          className="divide-y rounded-lg border text-body-sm"
        >
          {files.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2.5 px-3 py-2">
              <FileIcon name={entry.name} className="size-6 stroke-[1.5]" />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {analysed.has(entry.id) ? (
                <CircleCheck
                  aria-label={translate('stagedAnalysed')}
                  className="size-4 text-success-solid"
                />
              ) : current.has(entry.id) && analyse.isPending ? (
                <LoaderCircle
                  aria-label={translate('stagedAnalysingFile')}
                  className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
                />
              ) : (
                <Circle
                  aria-label={translate('waiting')}
                  className="size-4 text-muted-foreground/50"
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(1080px,calc(100vw-4rem))]! dark:bg-card"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 md:px-8">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-heidi-soft">
              <HeidiSparkle animated={analyse.isPending} />
            </span>
            <div className="grid min-w-0 gap-0.5">
              <SheetTitle className="text-title-sm font-semibold">
                {staged ? translate('stagedGroupingTitle') : translate('organizeTitle')}
              </SheetTitle>
              <SheetDescription className="text-body-sm text-muted-foreground">
                {staged
                  ? translate('stagedGroupingLead', { count: staged.files.length })
                  : translate('organizeLead')}
              </SheetDescription>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate('close')}
                onClick={onClose}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('close')}</TooltipContent>
          </Tooltip>
        </header>

        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-6 md:px-8">
          {analyse.error && <Callout tone="danger">{errorMessage(analyse.error)}</Callout>}
          {apply.error && <Callout tone="danger">{errorMessage(apply.error)}</Callout>}
          {file.error && <Callout tone="danger">{errorMessage(file.error)}</Callout>}

          {staged && !rows ? (
            <>
              {progress(staged.files)}
              {analyse.error && (
                <Button
                  variant="outline"
                  className="justify-self-start"
                  onClick={() => analyse.mutate()}
                >
                  {translate('retry')}
                </Button>
              )}
            </>
          ) : !rows ? (
            <div className="grid justify-items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-heidi-soft">
                <HeidiSparkle animated={analyse.isPending} className="size-5" />
              </span>
              <div className="grid max-w-[52ch] gap-1">
                <p className="text-title-sm font-medium">
                  {analyse.isPending
                    ? translate('organizeLooking')
                    : translate('organizeStartTitle')}
                </p>
                <p className="text-body-sm text-pretty text-muted-foreground">
                  {translate('organizeStartText')}
                </p>
              </div>
              <Button onClick={() => void start()} disabled={analyse.isPending}>
                {analyse.isPending ? (
                  <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <HeidiSparkle />
                )}
                {analyse.isPending ? translate('organizeLookingShort') : translate('organizeStart')}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-body-sm">
                  <span className="rounded-full bg-heidi-soft px-2.5 py-0.5 font-medium text-heidi">
                    {translate('organizeToMove', { count: changes.length })}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-surface px-2.5 py-0.5 text-success">
                    <CircleCheck aria-hidden className="size-3.5" />
                    {translate('organizeInPlace', { count: kept.length })}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {translate('organizeConsidered', { count: considered })}
                  </span>
                </div>
                {kept.length > 0 && !staged && (
                  <label className="flex items-center gap-2 text-caption text-muted-foreground">
                    <Switch checked={showKept} onCheckedChange={setShowKept} />
                    {translate('organizeShowKept')}
                  </label>
                )}
              </div>

              {shown.length === 0 ? (
                <Callout tone="success">{translate('organizeAllGood')}</Callout>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table
                    aria-label={translate('organizeProposals')}
                    className="w-full text-left text-body-sm"
                  >
                    <thead className="border-b bg-muted/40 text-caption text-muted-foreground">
                      <tr>
                        <th scope="col" className="w-10 px-3 py-2">
                          <Checkbox
                            aria-label={translate('selectAll3')}
                            checked={
                              tick === 0 ? false : tick === shown.length ? true : 'indeterminate'
                            }
                            onCheckedChange={(on) => {
                              for (const row of shown) toggle(row.document_id, on === true)
                            }}
                          />
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {translate('document')}
                        </th>
                        <th scope="col" className="w-6 px-0 py-2">
                          <span className="sr-only">{translate('organizeTo')}</span>
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {translate('organizeProposed')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shown.map((row) => {
                        return (
                          <tr
                            key={row.document_id}
                            className={cn('align-middle', !row.change && 'bg-muted/20')}
                          >
                            <td className="px-3 py-2.5">
                              <Checkbox
                                aria-label={translate('select', { name: row.name })}
                                checked={picked.has(row.document_id)}
                                onCheckedChange={(on) => toggle(row.document_id, on === true)}
                              />
                            </td>
                            <td className="max-w-72 px-2 py-2.5">
                              {/* The icon spans the name and the path, two lines tall. */}
                              <span className="flex min-w-0 items-center gap-2.5">
                                <FileIcon name={row.name} className="size-8 stroke-[1.5]" />
                                <span className="grid min-w-0">
                                  <span className="truncate font-medium">{row.name}</span>
                                  <span className="truncate text-caption text-muted-foreground">
                                    {readablePath(row.from_folder)}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td className="px-0 py-2.5 text-muted-foreground">
                              <ArrowRight aria-hidden className="size-4" />
                            </td>
                            <td className="min-w-80 px-2 py-2.5">
                              {proposed(row)}
                              {staged && facts(row)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-t px-5 py-2.5 md:px-8">
          <span className="text-body-sm text-muted-foreground">
            {rows ? translate('organizeSelected', { count: chosen.length }) : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              {staged ? translate('stagedBack') : translate('cancel')}
            </Button>
            {staged && rows && (
              <Button disabled={file.isPending} onClick={() => file.mutate(chosen)}>
                {translate('stagedApply', { count: staged.files.length })}
              </Button>
            )}
            {rows && !staged && (
              <Button
                disabled={!chosen.length || apply.isPending}
                onClick={() => apply.mutate(chosen)}
              >
                {translate('organizeApply', { count: chosen.length })}
              </Button>
            )}
          </div>
        </footer>
      </SheetContent>
    </Sheet>
  )
}

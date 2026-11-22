'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Switch } from '@helvetly/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CircleCheck, FolderInput, FolderPlus, LoaderCircle, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useAIApproval } from '@/components/ai/ai-approval'
import { inputClass } from '@/components/clients/fields'
import { FileIcon } from '@/components/import/import-files'
import { errorMessage } from '@/lib/api'
import {
  docsApi,
  refreshDocuments,
  useFolders,
  type Folder,
  type OrganizeProposal,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { pathLabel } from '@/lib/system-folders'

/** Every folder's path ("Invoices/2025"), lower-cased, to tell a proposed folder that exists from a new one. */
export function folderPaths(folders: Folder[]): Set<string> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const pathOf = (folder: Folder): string => {
    const parent = folder.parent_id ? byId.get(folder.parent_id) : undefined
    return parent ? `${pathOf(parent)}/${folder.name}` : folder.name
  }
  return new Set(folders.map((folder) => pathOf(folder).toLowerCase()))
}

/** A path as people read it: "Invoices › 2025", or "Top level". */
const shownPath = (path: string | null) =>
  path ? pathLabel(path).split('/').join(' › ') : translate('organizeTopLevel')

type Row = OrganizeProposal & { folderInput: string }

/**
 * Organize with AI: Heidi looks at the documents, unsorted ones first, and proposes a folder (new ones too, like
 * "Invoices/2025") and tags for each, re-checking where the sorted ones sit. Nothing moves until the person ticks
 * rows and applies them; the move can be undone from the toast.
 */
export function OrganizeDrawer({
  folderId,
  onClose,
}: {
  /** Limit to this folder's files and subfolders; none: the whole library. */
  folderId?: string | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { ensure } = useAIApproval()
  const folders = useFolders().data
  const existing = useMemo(() => folderPaths(folders ?? []), [folders])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [considered, setConsidered] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [showKept, setShowKept] = useState(false)

  const analyse = useMutation({
    mutationFn: async () => (await docsApi.organize(folderId ?? undefined)).data,
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
  const apply = useMutation({
    mutationFn: async (items: Row[]) =>
      (
        await docsApi.organizeApply(
          items.map((row) => ({
            document_id: row.document_id,
            folder: row.folderInput.trim().replace(/^\/+|\/+$/g, ''),
            tags: row.tags,
          })),
        )
      ).data,
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
  const shown = showKept ? (rows ?? []) : changes
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
  const proposed = (row: Row, isNew: boolean) => (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          {isNew ? (
            <FolderPlus
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-heidi"
            />
          ) : (
            <FolderInput
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
          )}
          <input
            aria-label={translate('organizeFolderFor', {
              name: row.name,
            })}
            value={row.folderInput}
            placeholder={translate('organizeTopLevel')}
            onChange={(event) => setFolder(row.document_id, event.target.value)}
            className={cn(inputClass, 'pl-8')}
          />
        </div>
        {isNew && (
          <Badge tone="violet" size="sm">
            {translate('organizeNewFolder')}
          </Badge>
        )}
      </div>
      {pathLabel(row.folderInput) !== row.folderInput && (
        // The field keeps the canonical path the server matches; this is how it reads in the user's language.
        <p className="truncate pl-1 text-caption text-muted-foreground">
          {shownPath(row.folderInput)}
        </p>
      )}
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
        {row.reason && (
          <span className="ml-1 text-caption text-pretty text-muted-foreground">{row.reason}</span>
        )}
      </div>
    </div>
  )

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
                {translate('organizeTitle')}
              </SheetTitle>
              <SheetDescription className="text-body-sm text-muted-foreground">
                {translate('organizeLead')}
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

          {!rows ? (
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
                {kept.length > 0 && (
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
                        const target = row.folderInput.trim().replace(/^\/+|\/+$/g, '')
                        const isNew = target !== '' && !existing.has(target.toLowerCase())
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
                                    {shownPath(row.from_folder)}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td className="px-0 py-2.5 text-muted-foreground">
                              <ArrowRight aria-hidden className="size-4" />
                            </td>
                            <td className="min-w-80 px-2 py-2.5">{proposed(row, isNew)}</td>
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
              {translate('cancel')}
            </Button>
            {rows && (
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

'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Sheet, SheetContent, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  FileSignature,
  FileText,
  FolderInput,
  Link2,
  Lock,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { PlanTag, useFeatureLock } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import type { KnownTag } from '@/components/clients/fields'
import { InlineTagsEditor } from '@/components/clients/inline-tags'
import { PdfView } from '@/components/invoices/pdf-view'
import { RecordPageButton } from '@/components/record-link'
import { useClientSearch } from '@/lib/clients'
import {
  contentUrl,
  daysLeft,
  downloadUrl,
  formatSize,
  isRetained,
  KIND_LABELS,
  docsApi,
  linkHref,
  refreshDocuments,
  tagCounts,
  useDoc,
  type DocFile,
  type DocLink,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import { folderLabel } from '@/lib/system-folders'

import { extractBlock } from './extract'
import { FolderMark } from './folder-art'
import { KindIcon, KIND_STYLE } from './kind'

export type PreviewCommands = {
  rename: (file: DocFile) => void
  move: (file: DocFile) => void
  copy: (file: DocFile) => void
  trash: (file: DocFile) => void
  restore: (file: DocFile) => void
  link: (file: DocFile, clientId: string) => void
  unlink: (file: DocFile, link: DocLink) => void
  openFolder: (folder: string | null) => void
  /** Starts a contract for signature from this PDF. */
  sign: (file: DocFile) => void
  /** Reads the file with AI into the import drawer's review. */
  extract: (file: DocFile) => void
}

const LINK_ICONS = {
  client: Building2,
  invoice: FileText,
  expense: Receipt,
  signature: FileSignature,
}

/** The file large, with its details and links on the right; ← and → step through the list. */
export function Preview({
  id,
  siblings,
  commands,
  onNavigate,
  onClose,
}: {
  id: string
  siblings: DocFile[]
  commands: PreviewCommands
  onNavigate: (id: string) => void
  onClose: () => void
}) {
  const canWrite = useCan('write:documents')
  const signLock = useFeatureLock('simple_signatures')
  const aiLock = useFeatureLock('ai_import')
  const query = useDoc(id)
  const file = query.data ?? siblings.find((sibling) => sibling.id === id)
  const index = siblings.findIndex((sibling) => sibling.id === id)
  const prev = index > 0 ? siblings[index - 1] : undefined
  const next = index >= 0 ? siblings[index + 1] : undefined

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea')) return
      if (event.key === 'ArrowLeft' && prev) onNavigate(prev.id)
      if (event.key === 'ArrowRight' && next) onNavigate(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, onNavigate])

  const trashed = !!file?.deleted_at
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        // Focus stays on the drawer itself, so no button (and its tooltip) lights up on open.
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-full! max-w-none! gap-0 overflow-hidden bg-card p-0 sm:w-[min(1680px,calc(100vw-3.5rem))]!"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4">
          {file ? <KindIcon kind={file.kind} /> : <Loader className="size-7 min-h-0 shrink-0" />}
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-[15px] font-medium">
              {file?.name ?? translate('loading')}
            </SheetTitle>
            {file && (
              <p className="truncate text-[12px] text-muted-foreground">
                {trashed
                  ? translate('inTheTrashDeletedForGoodInDays', {
                      value1: daysLeft(file.purge_at ?? ''),
                    })
                  : `${KIND_LABELS[file.kind]} · ${formatSize(file.size)}`}
              </p>
            )}
          </div>
          {siblings.length > 1 && index >= 0 && (
            <span className="hidden text-[12px] text-muted-foreground tabular-nums md:block">
              {index + 1}
              {translate('of5')}
              {siblings.length}
            </span>
          )}
          <HeaderButton
            label={translate('previous')}
            disabled={!prev}
            onClick={() => prev && onNavigate(prev.id)}
          >
            <ChevronLeft />
          </HeaderButton>
          <HeaderButton
            label={translate('next')}
            disabled={!next}
            onClick={() => next && onNavigate(next.id)}
          >
            <ChevronRight />
          </HeaderButton>
          <span className="mx-1 h-5 w-px bg-border" />
          {canWrite && file && !trashed && (
            <ExtractButton
              reason={aiLock?.hint ?? extractBlock([file], 0)}
              onClick={() => commands.extract(file)}
            />
          )}
          {file && (
            <Button asChild variant="outline" className="cursor-pointer gap-1.5">
              <a href={localizedHref(downloadUrl(file.id))}>
                <Download className="size-4" />
                <span className="max-sm:sr-only">{translate('download')}</span>
              </a>
            </Button>
          )}
          {canWrite && file && !trashed && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('more')}
                  className="cursor-pointer"
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                {file.kind === 'pdf' && (
                  <>
                    <DropdownMenuItem
                      disabled={Boolean(signLock)}
                      onSelect={() => commands.sign(file)}
                    >
                      <FileSignature />
                      {translate('sendForSignature')}
                      {signLock && <PlanTag lock={signLock} />}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onSelect={() => commands.rename(file)}>
                  <Pencil />
                  {translate('rename2')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => commands.move(file)}>
                  <FolderInput />
                  {translate('moveTo2')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => commands.copy(file)}>
                  <Copy />
                  {translate('makeACopy')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isRetained(file.retained_until)}
                  onSelect={() => commands.trash(file)}
                >
                  <Trash2 />
                  {translate('moveToTrash3')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canWrite && file && trashed && (
            <Button className="cursor-pointer gap-1.5" onClick={() => commands.restore(file)}>
              <RotateCcw className="size-4" />
              {translate('restore2')}
            </Button>
          )}
          <RecordPageButton />
          <HeaderButton label={translate('closeEsc')} onClick={onClose}>
            <X />
          </HeaderButton>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1 bg-muted/50 dark:bg-background">
            {file ? <Stage file={file} /> : null}
          </div>
          {file && (
            <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-l bg-panel lg:block dark:bg-background">
              <Details file={file} commands={commands} known={tagCounts(siblings)} />
            </aside>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** "Extract with AI": stays focusable when it cannot run, so its tooltip can say why. */
function ExtractButton({ reason, onClick }: { reason: string | null; onClick: () => void }) {
  const label = translate('extractWithAI')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ai"
          size="icon-sm"
          aria-label={label}
          aria-disabled={Boolean(reason)}
          className={cn('cursor-pointer', reason && 'cursor-not-allowed opacity-50')}
          onClick={reason ? undefined : onClick}
        >
          <Sparkles />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">
        {reason ? `${label}: ${reason}` : translate('extractWithAIHint')}
      </TooltipContent>
    </Tooltip>
  )
}

function HeaderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          className="cursor-pointer"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** What the file looks like: PDF pages, the image fitted, or a card to download it. */
function Stage({ file }: { file: DocFile }) {
  if (file.kind === 'pdf')
    return <PdfView src={contentUrl(file.id)} title={file.name} className="absolute inset-0" />
  if (file.kind === 'image')
    return (
      <div className="absolute inset-0 p-6 md:p-10">
        <div className="relative size-full">
          <Image
            src={contentUrl(file.id)}
            alt={file.name}
            fill
            unoptimized
            sizes="100vw"
            className="object-contain drop-shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
          />
        </div>
      </div>
    )
  const { icon: Icon, tint } = KIND_STYLE[file.kind]
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="grid max-w-xs justify-items-center gap-3 text-center">
        <span className={cn('flex size-16 items-center justify-center rounded-2xl', tint)}>
          <Icon className="size-7 stroke-[1.5]" />
        </span>
        <p className="text-[15px] font-medium">
          {translate('noPreviewFor')}
          {KIND_LABELS[file.kind].toLowerCase()}
          {translate('files2')}
        </p>
        <p className="text-sm text-muted-foreground">{translate('downloadItToOpenItInItsApp')}</p>
        <Button asChild size="sm" className="mt-1 cursor-pointer">
          <a href={localizedHref(downloadUrl(file.id))}>
            <Download className="size-4" />
            {translate('download4')}
            {formatSize(file.size)}
          </a>
        </Button>
      </div>
    </div>
  )
}

function Details({
  file,
  commands,
  known,
}: {
  file: DocFile
  commands: PreviewCommands
  known: KnownTag[]
}) {
  const canWrite = useCan('write:documents')
  const retained = isRetained(file.retained_until)
  const rows: [string, ReactNode][] = [
    [translate('kind'), KIND_LABELS[file.kind]],
    [translate('size'), formatSize(file.size)],
    [
      translate('location'),
      <button
        key="location"
        type="button"
        onClick={() => commands.openFolder(file.folder_id)}
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 underline underline-offset-2 hover:no-underline"
      >
        <FolderMark className="size-3.5" />
        <span className="truncate">
          {file.folder ? folderLabel(file.folder) : translate('allDocuments')}
        </span>
      </button>,
    ],
    [
      translate('uploaded2'),
      `${formatDate(file.created_at)}${file.uploaded_by?.name ? translate('dynamicBy', { name: file.uploaded_by.name }) : ''}`,
    ],
    [translate('modified'), formatDate(file.updated_at)],
  ]
  return (
    // minmax(0, 1fr): a long link label truncates instead of widening the column.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
      {retained && (
        <Callout tone="warning" icon={Lock}>
          <p>
            {translate('businessRecordKeptUntil2')}
            {formatDate(file.retained_until ?? '')}
            {translate('orArt958fItCanTBeMovedTo')}
          </p>
        </Callout>
      )}
      <Panel title={translate('details')} className="grid grid-cols-[minmax(0,1fr)]">
        <dl className="grid grid-cols-[minmax(0,1fr)] text-[13.5px]">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex min-h-10 items-center gap-3 border-t border-border/60 first:border-t-0"
            >
              <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 flex-1 py-2 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <TagsPanel file={file} canWrite={canWrite && !file.deleted_at} known={known} />
      <Panel
        title={translate('linkedTo')}
        className="grid grid-cols-[minmax(0,1fr)]"
        action={
          canWrite &&
          !file.deleted_at && <AttachClient onPick={(clientId) => commands.link(file, clientId)} />
        }
      >
        {file.links.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {translate('notLinkedYetAttachItToAClientTo')}
          </p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {file.links.map((link) => {
              const Icon = LINK_ICONS[link.type]
              return (
                <li
                  key={`${link.type}:${link.id}`}
                  className="group/link flex h-9 items-center gap-2 rounded-lg px-2 text-[13.5px] hover:bg-muted"
                >
                  <Icon className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
                  <Link
                    href={linkHref(link)}
                    className="min-w-0 flex-1 truncate underline underline-offset-2 hover:no-underline"
                  >
                    {link.label}
                  </Link>
                  {link.retains ? (
                    <Lock
                      aria-label={translate('keepsThisFile')}
                      className="size-3.5 text-muted-foreground"
                    />
                  ) : (
                    canWrite &&
                    !file.deleted_at && (
                      <button
                        type="button"
                        aria-label={translate('unlink', { label: link.label })}
                        onClick={() => commands.unlink(file, link)}
                        className="cursor-pointer rounded p-1 text-destructive opacity-0 group-hover/link:opacity-100 hover:bg-destructive/10 focus-visible:opacity-100"
                      >
                        <X className="size-3.5" />
                      </button>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
      {file.sha256 && (
        <Panel title={translate('integrity')} className="grid grid-cols-[minmax(0,1fr)]">
          <button
            type="button"
            aria-label={translate('copySHA256', { sha256: file.sha256 })}
            onClick={() =>
              void navigator.clipboard
                .writeText(file.sha256 ?? '')
                .then(() => toast.success(translate('sha256Copied')))
            }
            className="group/sha font-code flex w-full cursor-pointer items-center gap-2 rounded-lg bg-muted/60 py-2 pr-2 pl-2.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="min-w-0 flex-1 truncate">
              {translate('sha256')}
              {file.sha256}
            </span>
            <Copy className="size-3.5 shrink-0 opacity-60 transition-opacity group-hover/sha:opacity-100" />
          </button>
        </Panel>
      )}
    </div>
  )
}

/** The file's tags, edited in place, and what AI filing did with it (with Undo). */
function TagsPanel({
  file,
  canWrite,
  known,
}: {
  file: DocFile
  canWrite: boolean
  known: KnownTag[]
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const undo = () =>
    void docsApi.undoFiling(file.id).then(() => {
      refreshDocuments(queryClient)
      toast.success(translate('aiFilingUndone', { count: 1 }))
    }, toastError)
  const filed = file.ai_filing?.status === 'filed' ? file.ai_filing : null
  return (
    <Panel
      title={translate('tags')}
      className="grid grid-cols-[minmax(0,1fr)] gap-2"
      action={
        canWrite &&
        !editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            {translate('edit')}
          </Button>
        )
      }
    >
      {editing ? (
        <InlineTagsEditor
          initial={file.tags}
          known={known}
          save={(tags) =>
            docsApi.update(file.id, { tags }).then(() => refreshDocuments(queryClient))
          }
          onDone={() => setEditing(false)}
        />
      ) : file.tags.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {file.tags.map((tag) => (
            <Badge size="sm" key={tag}>
              {tag}
            </Badge>
          ))}
        </span>
      ) : (
        <p className="text-body-sm text-muted-foreground">{translate('noTagsYet')}</p>
      )}
      {filed && (
        <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Sparkles className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {filed.folder
              ? translate('sortedByAIInto', { folder: folderLabel(filed.folder) })
              : translate('sortedByAI')}
          </span>
          {canWrite && (
            <button
              type="button"
              onClick={undo}
              className="shrink-0 cursor-pointer underline underline-offset-2 hover:no-underline"
            >
              {translate('undo')}
            </button>
          )}
        </p>
      )}
    </Panel>
  )
}

/** "Attach to client": search clients and link the file to one. */
function AttachClient({ onPick }: { onPick: (clientId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const search = useClientSearch(term, open)
  const clients = search.data?.data ?? []
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="cursor-pointer gap-1 px-2">
          <Plus className="size-3.5" />
          {translate('client3')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-1 p-1.5">
        {/* A menu's search: quiet, the menu is its box (field-surface.spec.ts). */}
        <label className="field-quiet flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground">
          <Search className="size-4 shrink-0" />
          <input
            aria-label={translate('searchClients')}
            placeholder={translate('searchClients')}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
          />
        </label>
        <div className="max-h-60 overflow-y-auto">
          {clients.length === 0 ? (
            <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">
              {search.isPending ? translate('searching') : translate('noClientsFound')}
            </p>
          ) : (
            clients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => {
                  onPick(client.id)
                  setOpen(false)
                }}
                className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
              >
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{client.name}</span>
                <span className="font-code text-[12px] text-muted-foreground">
                  #{client.number}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

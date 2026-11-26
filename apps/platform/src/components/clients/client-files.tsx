'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate, formatFileSize } from '@helvetly/ui/lib/format'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Eye, Paperclip, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactElement, type ReactNode } from 'react'
import { toast } from 'sonner'

import { promptUpgrade, toastError } from '@/components/billing/upgrade-prompt'
import { FileTile, kindOfType } from '@/components/documents/kind'
import { ShareButton, ShareDialog } from '@/components/documents/share-dialog'
import { RecordLink } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import {
  clientKeys,
  fileUrl,
  uploadClientFiles,
  useClientFiles,
  useDeleteClientFile,
  type ClientFile,
} from '@/lib/clients'
import { translate } from '@/lib/i18n'

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.doc,.docx,.txt'
const MAX_FILES = 10
const TYPES_HINT = translate('pdfImagesOfficeCSVOrTextUpTo25')

/** Where Documents previews this file (a client's files are documents linked to it). */
export const previewHref = (file: Pick<ClientFile, 'id'>) =>
  `/documents?${new URLSearchParams({ file: file.id })}`

/** "8 KB · 6 Nov 2026 · Anna Muster" */
export const fileMeta = (file: ClientFile) =>
  [formatFileSize(file.size), formatDate(file.created_at), file.uploaded_by?.name]
    .filter(Boolean)
    .join(' · ')

type Label = Parameters<typeof translate>[0]
/** The groups in the order they show, each with the kind tags it holds; the plural labels match Documents' Group by type. */
const KIND_GROUPS: [Label, string[]][] = [
  ['contracts', ['contract']],
  [
    'invoices',
    [
      'invoice',
      'partial-invoice',
      'prepayment-invoice',
      'corrected-invoice',
      'proforma-invoice',
      'self-billed-invoice',
    ],
  ],
  ['creditNotes', ['credit-note']],
  ['debitNotes', ['debit-note']],
  ['quotes', ['quote']],
  ['docTypePaymentConfirmations', ['payment-confirmation']],
  ['engagements', ['engagement']],
  // A signed file with a kind stays with its kind; this holds signed files of no kind.
  ['clientFilesSigned', []],
  ['docTypeConsents', ['consent']],
  ['docTypePowersOfAttorney', ['power-of-attorney']],
  ['docTypeReceipts', ['receipt']],
  ['bankStatements', ['bank-statement']],
  ['clientFilesOther', []],
]

const groupOf = (tags: string[] = []): Label =>
  KIND_GROUPS.find(([, kinds]) => kinds.some((kind) => tags.includes(kind)))?.[0] ??
  (tags.includes('signed') ? 'clientFilesSigned' : 'clientFilesOther')

/** The files by kind in a fixed order, empty groups left out; each keeps the list's order (newest first). */
export function groupFiles(files: ClientFile[]) {
  return KIND_GROUPS.map(([key]) => ({
    key,
    label: translate(key),
    files: files.filter((file) => groupOf(file.locked_tags) === key),
  })).filter((group) => group.files.length > 0)
}

/** Only a drag that carries files lights the drop overlay (not a dragged link or text). */
const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The client's files: a header with the count and Upload, the files as rows with preview, download and delete,
 * and a drop overlay while files are dragged over the tab. The server checks type, size and duplicates.
 */
export function ClientFiles({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient()
  const files = useClientFiles(clientId)
  const remove = useDeleteClientFile(clientId)
  const picker = useRef<HTMLInputElement>(null)
  // dragenter/dragleave fire for every child; a depth count keeps the overlay from flickering.
  const depth = useRef(0)
  const [over, setOver] = useState(false)
  const [upload, setUpload] = useState<{ names: string[]; progress: number } | null>(null)
  const [deleting, setDeleting] = useState<ClientFile | null>(null)

  const send = (picked: File[]) => {
    if (!picked.length || upload) return
    if (picked.length > MAX_FILES)
      toast.error(translate('upToFilesAtOnce', { MAX_FILES: MAX_FILES }))
    const batch = picked.slice(0, MAX_FILES)
    setUpload({ names: batch.map((file) => file.name), progress: 0 })
    // Sizes and same-batch duplicates are checked first; the server checks types and says what it refused.
    uploadClientFiles(clientId, batch, (progress) =>
      setUpload((current) => current && { ...current, progress }),
    )
      .then((added) => {
        toast.success(
          added.length === 1
            ? translate('uploaded', { value1: added[0]?.name })
            : translate('filesUploaded', { length: added.length }),
        )
      })
      .catch((error: unknown) => {
        if (!promptUpgrade(error)) toast.error(errorMessage(error))
      })
      .finally(() => {
        // A later pack can fail after earlier ones were stored, so the list refreshes either way.
        setUpload(null)
        void queryClient.invalidateQueries({ queryKey: clientKeys.files(clientId) })
        void queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId), exact: true })
      })
  }

  const drag = {
    onDragEnter: (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth.current += 1
      setOver(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = upload ? 'none' : 'copy'
    },
    onDragLeave: (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setOver(false)
      send([...event.dataTransfer.files])
    },
  }

  const count = files.data?.length ?? 0
  return (
    <div {...drag} data-over={over || undefined} className="relative">
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            {translate('files')}{' '}
            {count > 0 && (
              <Badge size="sm" className="tabular-nums">
                {count}
              </Badge>
            )}
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <span className="text-caption text-muted-foreground max-sm:hidden">
              {translate('orDropFilesHere')}
            </span>
            <Tip label={TYPES_HINT}>
              <Button
                variant="outline"
                size="sm"
                disabled={upload !== null}
                onClick={() => picker.current?.click()}
              >
                <Upload />
                {translate('upload')}
              </Button>
            </Tip>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              aria-label={translate('uploadFiles')}
              onChange={(event) => {
                send([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
          </div>
        }
      >
        {upload && (
          <output className="mb-2 grid gap-1.5 rounded-lg bg-muted/60 px-3 py-2.5 text-body-sm">
            <span className="truncate">
              {translate('uploading')}{' '}
              {upload.names.length === 1
                ? upload.names[0]
                : translate('dynamicFiles', { length: upload.names.length })}
              …
            </span>
            <span className="h-1 overflow-hidden rounded-full bg-border">
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${Math.round(upload.progress * 100)}%` }}
              />
            </span>
          </output>
        )}

        {files.isPending ? (
          <Loader className="min-h-24" />
        ) : files.error ? (
          <InlineError>
            {errorMessage(files.error)}{' '}
            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() => void files.refetch()}
            >
              {translate('tryAgain')}
            </button>
          </InlineError>
        ) : count === 0 ? (
          <EmptyState
            icon={Paperclip}
            title={translate('noFilesYet')}
            description={translate('dropContractsReceiptsOrOtherFilesHereOrUse', {
              TYPES_HINT: TYPES_HINT,
            })}
            className="rounded-lg border border-dashed border-border py-8"
          />
        ) : (
          <FileGroups groups={groupFiles(files.data)}>
            {(file) => (
              <FileRow
                key={file.id}
                clientId={clientId}
                file={file}
                onDelete={() => setDeleting(file)}
              />
            )}
          </FileGroups>
        )}
      </Panel>

      {over && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center drop-zone bg-card text-body"
        >
          <span className="flex items-center gap-2 font-medium">
            <Upload className="size-4 text-brand" />
            {translate('dropToUploadToThisClient')}
          </span>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          key={deleting.id}
          title={translate('delete4', { name: deleting.name })}
          body={translate('itMovesToTheTrashInDocumentsWhereIt')}
          confirmLabel={translate('deleteFile')}
          tone="destructive"
          onDecide={(approved) => {
            const file = deleting
            setDeleting(null)
            if (approved)
              remove.mutate(file.id, {
                onSuccess: () => toast.success(translate('movedToTheTrash', { name: file.name })),
                onError: toastError,
              })
          }}
        />
      )}
    </div>
  )
}

/** One plain list for a single kind; with several, each kind under a small header with its count. */
function FileGroups({
  groups,
  children,
}: {
  groups: ReturnType<typeof groupFiles>
  children: (file: ClientFile) => ReactNode
}) {
  const [only] = groups
  if (groups.length === 1 && only) return <ul className="grid">{only.files.map(children)}</ul>
  return (
    <div className="grid gap-3">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`client-files-${group.key}`}>
          <h3
            id={`client-files-${group.key}`}
            className="flex items-center gap-1.5 pb-0.5 text-caption font-medium text-muted-foreground"
          >
            {group.label}
            <span className="tabular-nums">{group.files.length}</span>
          </h3>
          <ul className="grid">{group.files.map(children)}</ul>
        </section>
      ))}
    </div>
  )
}

function FileRow({
  clientId,
  file,
  onDelete,
}: {
  clientId: string
  file: ClientFile
  onDelete: () => void
}) {
  const href = fileUrl(clientId, file.id)
  const kind = kindOfType(file.content_type)
  const [sharing, setSharing] = useState(false)
  return (
    <li className="group/file -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50">
      <FileTile file={{ name: file.name, kind }} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <a
          href={localizedHref(href)}
          className="truncate text-body underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground"
        >
          {file.name}
        </a>
        <span className="truncate text-caption text-muted-foreground">{fileMeta(file)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/file:opacity-100 group-hover/file:opacity-100 max-sm:opacity-100">
        <Tip label={translate('previewInDocuments')}>
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={translate('preview2', { name: file.name })}
          >
            <RecordLink href={previewHref(file)}>
              <Eye />
            </RecordLink>
          </Button>
        </Tip>
        <ShareButton file={file} onOpen={() => setSharing(true)} />
        <Tip label={translate('download')}>
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={translate('download2', { name: file.name })}
          >
            <a href={localizedHref(href)}>
              <Download />
            </a>
          </Button>
        </Tip>
        <Tip label={translate('delete3')}>
          <Button
            variant="destructive-ghost"
            size="icon-sm"
            aria-label={translate('delete2', { name: file.name })}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </Tip>
      </span>
      {sharing && (
        <ShareDialog
          // This client is the likely audience.
          file={{
            ...file,
            kind,
            links: [{ type: 'client', id: clientId, label: '', retains: false }],
          }}
          onClose={() => setSharing(false)}
        />
      )}
    </li>
  )
}

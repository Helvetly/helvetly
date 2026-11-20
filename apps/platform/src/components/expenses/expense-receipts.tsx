'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { Loader } from '@helvetly/ui/components/loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate, formatFileSize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  ImageIcon,
  Maximize2,
  Plus,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import Image from 'next/image'
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'

import { promptUpgrade, toastError } from '@/components/billing/upgrade-prompt'
import { PdfView } from '@/components/invoices/pdf-view'
import { errorMessage } from '@/lib/api'
import {
  RECEIPT_ACCEPT,
  RECEIPT_MAX_FILES,
  receiptsChanged,
  receiptUrl,
  uploadReceipts,
  useDeleteReceipt,
  useReceipts,
  type Receipt,
} from '@/lib/expenses'
import { translate } from '@/lib/i18n'

/** Browsers show these inline; HEIC (iPhone photos) downloads instead. */
const isPhoto = (type: string) => /^image\/(png|jpeg|webp)$/.test(type)
const isPdf = (type: string) => type === 'application/pdf'

/** The file input of the receipts block: the drawer's "Not ready to book" notice opens it. */
export const RECEIPT_INPUT_ID = 'expense-receipt-input'

/** A drop area that also opens the file picker on click. */
export function ReceiptDrop({
  onFiles,
  disabled,
  compact,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  compact?: boolean
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      data-over={over || undefined}
      className={cn(
        'relative grid justify-items-center gap-1 rounded-xl border border-dashed border-border px-4 text-center text-body-sm text-muted-foreground transition-colors duration-150 hover:border-foreground/25 has-focus-visible:ring-3 has-focus-visible:ring-ring/40 data-over:border-brand-solid/45 data-over:bg-brand-surface/70',
        compact ? 'py-5' : 'py-8',
      )}
    >
      <span className="mb-1 flex size-9 items-center justify-center rounded-full ring-1 ring-border">
        <Upload className="size-4 stroke-[1.5]" />
      </span>
      <span>
        <span className="font-medium text-foreground">{translate('dropTheReceiptHere')}</span>
        {translate('orClickToChoose')}
      </span>
      <span className="text-xs">{translate('pdfOrAPhotoJPEGPNGWebPHEICUp')}</span>
      <input
        type="file"
        multiple
        accept={RECEIPT_ACCEPT}
        id={RECEIPT_INPUT_ID}
        aria-label={translate('uploadReceipts')}
        disabled={disabled}
        onDragEnter={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > RECEIPT_MAX_FILES)
            toast.error(translate('upToReceiptsAtOnce', { RECEIPT_MAX_FILES: RECEIPT_MAX_FILES }))
          if (files.length) onFiles(files.slice(0, RECEIPT_MAX_FILES))
        }}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-progress"
      />
    </div>
  )
}

/** Picked files of a new expense, uploaded once it is saved; images show a thumbnail. */
export function StagedReceipts({
  files,
  onRemove,
}: {
  files: File[]
  onRemove: (file: File) => void
}) {
  return (
    <ul className="grid gap-2">
      {files.map((file) => (
        <li
          key={`${file.name}-${file.size}`}
          className="flex items-center gap-3 rounded-lg px-2.5 py-2 ring-1 ring-border"
        >
          <StagedThumbnail file={file} />
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="text-body-sm break-all">{file.name}</span>
            <span className="text-xs text-muted-foreground">
              {formatFileSize(file.size)}
              {translate('uploadsWhenYouSave')}
            </span>
          </span>
          <Button
            type="button"
            variant="destructive-ghost"
            size="icon-sm"
            aria-label={translate('remove2', { name: file.name })}
            className="cursor-pointer"
            onClick={() => onRemove(file)}
          >
            <X />
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** Shown until the effect has the object URL; React never sets `src` again, so it is not overwritten. */
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

/**
 * A photo's thumbnail, the file icon for anything else or when the browser cannot decode it. The effect owns its
 * object URL (created in setup, revoked in cleanup), so a development StrictMode replay never leaves a revoked one shown.
 */
function StagedThumbnail({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null)
  // The file that failed to decode, not a flag: another file under the same list key gets its own try.
  const [brokenFile, setBrokenFile] = useState<File>()
  const isImage = /^image\/(png|jpeg|webp)$/.test(file.type)
  useEffect(() => {
    if (!isImage || !image.current) return
    const url = URL.createObjectURL(file)
    image.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [file, isImage])
  if (isImage && brokenFile !== file)
    return (
      <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border">
        <Image
          ref={image}
          src={BLANK_PIXEL}
          alt=""
          fill
          unoptimized
          sizes="40px"
          className="object-cover"
          onError={() => setBrokenFile(file)}
        />
      </span>
    )
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <FileText className="size-4 stroke-[1.5]" />
    </span>
  )
}

/** An icon-only action with its name as a tooltip. */
function IconAction({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & Omit<ComponentProps<typeof Button>, 'children'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className="cursor-pointer text-muted-foreground"
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const receiptMeta = (receipt: Receipt) =>
  [formatFileSize(receipt.size), formatDate(receipt.created_at), receipt.uploaded_by?.name]
    .filter(Boolean)
    .join(' · ')

/**
 * The expense's receipts in its drawer: a preview card of the chosen one (click for full size), its file as the
 * caption with download and delete, a strip of every receipt ending in a drop tile to add more.
 */
export function ExpenseReceipts({
  expenseId,
  editable,
  uploadable,
}: {
  expenseId: string
  /** Receipts can be removed (drafts only). */
  editable: boolean
  /** New receipts can be added (not on a voided expense). */
  uploadable: boolean
}) {
  const queryClient = useQueryClient()
  const receipts = useReceipts(expenseId)
  const remove = useDeleteReceipt(expenseId)
  const [chosen, setChosen] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)
  const [upload, setUpload] = useState<{ names: string[]; progress: number } | null>(null)
  const [deleting, setDeleting] = useState<Receipt | null>(null)
  const list = receipts.data ?? []
  const shown = list.find((receipt) => receipt.id === chosen) ?? list[0]

  const send = (files: File[]) => {
    if (upload) return
    setUpload({ names: files.map((file) => file.name), progress: 0 })
    uploadReceipts(expenseId, files, (progress) =>
      setUpload((current) => current && { ...current, progress }),
    )
      .then((added) => {
        toast.success(
          added.length === 1
            ? translate('attached', { value1: added[0]?.name })
            : translate('receiptsAttached', { length: added.length }),
        )
        setChosen(added[0]?.id ?? null)
      })
      .catch((error: unknown) => {
        if (!promptUpgrade(error)) toast.error(errorMessage(error))
      })
      .finally(() => {
        // A later pack can fail after earlier ones were stored, so the lists refresh either way.
        setUpload(null)
        receiptsChanged(queryClient, expenseId)
      })
  }

  if (receipts.isPending) return <Loader className="min-h-64" />
  if (receipts.error)
    return (
      <p className="text-body-sm text-muted-foreground">
        {translate('theReceiptsCouldnTBeLoaded')}{' '}
        <button
          type="button"
          className="cursor-pointer underline"
          onClick={() => void receipts.refetch()}
        >
          {translate('tryAgain')}
        </button>
      </p>
    )

  if (!shown)
    return uploadable ? (
      <div className="grid gap-3">
        <ReceiptDrop onFiles={send} disabled={upload !== null} />
        {upload && <UploadProgress upload={upload} />}
      </div>
    ) : (
      <p className="text-body-sm text-muted-foreground">{translate('receiptNone')}</p>
    )

  const index = list.indexOf(shown)
  return (
    <div className="grid gap-2.5">
      <figure
        data-testid="receipt-card"
        className="overflow-hidden rounded-xl bg-card ring-1 ring-border"
      >
        <ReceiptStage expenseId={expenseId} receipt={shown} onOpen={() => setViewing(true)} />
        <figcaption className="flex items-center gap-3 border-t border-border/60 py-2 pr-2 pl-3">
          <FileBadge type={shown.content_type} />
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-body-sm font-medium" title={shown.name}>
              {shown.name}
            </span>
            <span className="truncate text-xs text-muted-foreground">{receiptMeta(shown)}</span>
          </span>
          <span className="flex shrink-0 items-center">
            <IconAction label={translate('receiptViewFullSize')} onClick={() => setViewing(true)}>
              <Maximize2 />
            </IconAction>
            <IconAction label={translate('download2', { name: shown.name })} asChild>
              <a href={localizedHref(receiptUrl(expenseId, shown.id))}>
                <Download />
              </a>
            </IconAction>
            {editable && (
              <IconAction
                label={translate('delete2', { name: shown.name })}
                variant="destructive-ghost"
                className="cursor-pointer"
                onClick={() => setDeleting(shown)}
              >
                <Trash2 />
              </IconAction>
            )}
          </span>
        </figcaption>
      </figure>

      {(list.length > 1 || uploadable) && (
        <ul aria-label={translate('receiptAll')} className="-m-1 flex gap-2 overflow-x-auto p-1">
          {list.map((receipt) => (
            <li key={receipt.id} className="shrink-0">
              <ReceiptThumb
                expenseId={expenseId}
                receipt={receipt}
                selected={receipt.id === shown.id}
                onSelect={() => setChosen(receipt.id)}
              />
            </li>
          ))}
          {upload && (
            <li className="shrink-0">
              <UploadTile upload={upload} />
            </li>
          )}
          {uploadable && (
            <li className="shrink-0">
              <AddTile onFiles={send} disabled={upload !== null} />
            </li>
          )}
        </ul>
      )}

      {viewing && (
        <ReceiptViewer
          expenseId={expenseId}
          receipts={list}
          index={index}
          onIndex={(next) => setChosen(list[next]?.id ?? null)}
          onClose={() => setViewing(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          key={deleting.id}
          title={translate('delete4', { name: deleting.name })}
          body={translate('theFileIsRemovedFromThisDraftForGood')}
          confirmLabel={translate('deleteReceipt')}
          tone="destructive"
          onDecide={(approved) => {
            const receipt = deleting
            setDeleting(null)
            if (!approved) return
            if (receipt.id === chosen) setChosen(null)
            remove.mutate(receipt.id, {
              onSuccess: () => toast.success(translate('deleted3', { name: receipt.name })),
              onError: toastError,
            })
          }}
        />
      )}
    </div>
  )
}

function FileBadge({ type }: { type: string }) {
  const Icon = isPhoto(type) ? ImageIcon : FileText
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand">
      <Icon className="size-4 stroke-[1.5]" />
    </span>
  )
}

/** The card's preview: a photo opens the full-size viewer, a PDF scrolls in place, HEIC offers the download. */
function ReceiptStage({
  expenseId,
  receipt,
  onOpen,
}: {
  expenseId: string
  receipt: Receipt
  onOpen: () => void
}) {
  const src = receiptUrl(expenseId, receipt.id, true)
  if (isPdf(receipt.content_type))
    return <PdfView src={src} title={receipt.name} className="h-[420px] max-sm:h-[360px]" />
  if (!isPhoto(receipt.content_type))
    return (
      <a
        href={localizedHref(receiptUrl(expenseId, receipt.id))}
        className="grid cursor-pointer justify-items-center gap-2 bg-muted/40 px-4 py-12 text-center text-body-sm text-muted-foreground hover:text-foreground dark:bg-background"
      >
        <FileText className="size-6 stroke-[1.5]" />
        <span>{translate('thisPhotoFormatHasNoPreviewInTheBrowser')}</span>
      </a>
    )
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={translate('receiptOpen', { name: receipt.name })}
      className="relative block h-[360px] w-full cursor-zoom-in bg-muted/40 outline-none focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-ring/40 max-sm:h-[300px] dark:bg-background"
    >
      <Image
        key={receipt.id}
        src={src}
        alt={receipt.name}
        fill
        unoptimized
        loading="eager"
        sizes="680px"
        className="object-contain p-4"
      />
    </button>
  )
}

const tile = 'relative flex size-16 items-center justify-center overflow-hidden rounded-lg'

function ReceiptThumb({
  expenseId,
  receipt,
  selected,
  onSelect,
}: {
  expenseId: string
  receipt: Receipt
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={translate('receiptShow', { name: receipt.name })}
      title={receipt.name}
      className={cn(
        tile,
        'cursor-pointer bg-muted/60 ring-1 ring-border transition-shadow duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-background',
        selected ? 'ring-2 ring-primary' : 'hover:ring-foreground/25',
      )}
    >
      {isPhoto(receipt.content_type) ? (
        <Image
          src={receiptUrl(expenseId, receipt.id, true)}
          alt=""
          fill
          unoptimized
          sizes="64px"
          loading="eager"
          className="object-cover"
        />
      ) : (
        <span className="grid justify-items-center gap-0.5 text-muted-foreground">
          <FileText className="size-5 stroke-[1.5]" />
          <span className="text-caption font-medium tracking-wide uppercase">
            {isPdf(receipt.content_type) ? 'PDF' : (receipt.name.split('.').pop() ?? '')}
          </span>
        </span>
      )}
    </button>
  )
}

/** The strip's last tile: click to choose files or drop them on it. */
function AddTile({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const [over, setOver] = useState(false)
  return (
    <span
      data-over={over || undefined}
      className={cn(
        tile,
        'flex-col gap-0.5 border border-dashed border-foreground/20 text-muted-foreground transition-colors duration-150 hover:border-foreground/35 hover:text-foreground has-focus-visible:ring-3 has-focus-visible:ring-ring/40 data-over:border-brand-solid/45 data-over:bg-brand-surface/70 data-over:text-foreground',
      )}
    >
      <Plus className="size-4" />
      <span className="text-caption leading-none">{translate('receiptAddShort')}</span>
      <input
        type="file"
        multiple
        id={RECEIPT_INPUT_ID}
        accept={RECEIPT_ACCEPT}
        aria-label={translate('addAnotherReceipt').trim()}
        title={translate('addAnotherReceipt').trim()}
        disabled={disabled}
        onDragEnter={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > RECEIPT_MAX_FILES)
            toast.error(translate('upToReceiptsAtOnce', { RECEIPT_MAX_FILES: RECEIPT_MAX_FILES }))
          if (files.length) onFiles(files.slice(0, RECEIPT_MAX_FILES))
        }}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-progress"
      />
    </span>
  )
}

type Upload = { names: string[]; progress: number }

const uploadLabel = (upload: Upload) =>
  `${translate('uploading')} ${
    upload.names.length === 1
      ? upload.names[0]
      : translate('dynamicReceipts', { length: upload.names.length })
  }…`

function UploadTile({ upload }: { upload: Upload }) {
  return (
    <output
      aria-label={uploadLabel(upload)}
      title={uploadLabel(upload)}
      className={cn(tile, 'flex-col gap-1.5 bg-muted/60 px-2.5 ring-1 ring-border')}
    >
      <Upload className="size-4 text-muted-foreground" />
      <span className="h-1 w-full overflow-hidden rounded-full bg-border">
        <span
          className="block h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${Math.round(upload.progress * 100)}%` }}
        />
      </span>
    </output>
  )
}

function UploadProgress({ upload }: { upload: Upload }) {
  return (
    <output className="grid gap-1.5 rounded-lg px-3 py-2.5 text-body-sm ring-1 ring-border">
      <span className="break-all">{uploadLabel(upload)}</span>
      <span className="h-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${Math.round(upload.progress * 100)}%` }}
        />
      </span>
    </output>
  )
}

const ZOOMS = [1, 1.5, 2, 3]

/** Full size over the page: zoom (buttons, or a click on the photo), arrows between receipts, download. */
function ReceiptViewer({
  expenseId,
  receipts,
  index,
  onIndex,
  onClose,
}: {
  expenseId: string
  receipts: Receipt[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const receipt = receipts[index]
  if (!receipt) return null
  const photo = isPhoto(receipt.content_type)
  const many = receipts.length > 1
  const go = (step: number) => {
    setZoom(1)
    onIndex((index + step + receipts.length) % receipts.length)
  }
  const zoomTo = (level: number | undefined) => level && setZoom(level)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (!many) return
          if (event.key === 'ArrowLeft') go(-1)
          if (event.key === 'ArrowRight') go(1)
        }}
        className="flex h-[min(92dvh,1000px)] w-[min(1100px,calc(100vw-1rem))] max-w-none! flex-col gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">{receipt.name}</DialogTitle>
        <DialogDescription className="sr-only">{receiptMeta(receipt)}</DialogDescription>
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border/60 pr-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-body-sm font-medium">{receipt.name}</span>
          {many && (
            <span className="px-1.5 text-xs text-muted-foreground tabular-nums">
              {index + 1} / {receipts.length}
            </span>
          )}
          {photo && (
            <>
              <IconAction
                label={translate('receiptZoomOut')}
                disabled={zoom === ZOOMS[0]}
                onClick={() => zoomTo(ZOOMS[ZOOMS.indexOf(zoom) - 1])}
              >
                <ZoomOut />
              </IconAction>
              <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <IconAction
                label={translate('receiptZoomIn')}
                disabled={zoom === ZOOMS.at(-1)}
                onClick={() => zoomTo(ZOOMS[ZOOMS.indexOf(zoom) + 1])}
              >
                <ZoomIn />
              </IconAction>
            </>
          )}
          <IconAction label={translate('download2', { name: receipt.name })} asChild>
            <a href={localizedHref(receiptUrl(expenseId, receipt.id))}>
              <Download />
            </a>
          </IconAction>
          <IconAction label={translate('close')} onClick={onClose}>
            <X />
          </IconAction>
        </header>
        <div className="relative min-h-0 flex-1 bg-muted/50 dark:bg-background">
          <div className="absolute inset-0 overflow-auto">
            {isPdf(receipt.content_type) ? (
              <PdfView
                src={receiptUrl(expenseId, receipt.id, true)}
                title={receipt.name}
                className="h-full"
              />
            ) : photo ? (
              <button
                type="button"
                aria-label={translate(zoom === 1 ? 'receiptZoomIn' : 'receiptZoomOut')}
                onClick={() => setZoom(zoom === 1 ? 2 : 1)}
                style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
                className={cn(
                  'relative block min-h-full min-w-full outline-none',
                  zoom === 1 ? 'cursor-zoom-in' : 'cursor-zoom-out',
                )}
              >
                <Image
                  key={receipt.id}
                  src={receiptUrl(expenseId, receipt.id, true)}
                  alt={receipt.name}
                  fill
                  unoptimized
                  loading="eager"
                  sizes="100vw"
                  className="object-contain p-4"
                />
              </button>
            ) : (
              <div className="grid h-full place-content-center justify-items-center gap-2 p-6 text-center text-body-sm text-muted-foreground">
                <FileText className="size-6 stroke-[1.5]" />
                <span>{translate('thisPhotoFormatHasNoPreviewInTheBrowser')}</span>
              </div>
            )}
          </div>
          {many && (
            <>
              <ViewerArrow
                side="left"
                label={translate('receiptPrevious')}
                onClick={() => go(-1)}
              />
              <ViewerArrow side="right" label={translate('receiptNext')} onClick={() => go(1)} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ViewerArrow({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right'
  label: string
  onClick: () => void
}) {
  return (
    <IconAction
      label={label}
      variant="outline"
      size="icon"
      className={cn(
        'absolute top-1/2 -translate-y-1/2 cursor-pointer rounded-full',
        side === 'left' ? 'left-3' : 'right-3',
      )}
      onClick={onClick}
    >
      {side === 'left' ? <ChevronLeft /> : <ChevronRight />}
    </IconAction>
  )
}

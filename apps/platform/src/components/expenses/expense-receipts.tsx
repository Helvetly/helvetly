'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Loader } from '@helvetly/ui/components/loader'
import { formatDate, formatFileSize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileText, ReceiptText, Trash2, Upload, X } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { promptUpgrade, toastError } from '@/components/billing/upgrade-prompt'
import { PdfView } from '@/components/invoices/pdf-view'
import { errorMessage } from '@/lib/api'
import {
  expenseKeys,
  RECEIPT_ACCEPT,
  RECEIPT_MAX_FILES,
  receiptUrl,
  uploadReceipts,
  useDeleteReceipt,
  useReceipts,
  type Receipt,
} from '@/lib/expenses'

/** Browsers show these inline; HEIC (iPhone photos) downloads instead. */
const previewable = (type: string) =>
  type === 'application/pdf' || /^image\/(png|jpeg|webp)$/.test(type)

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
        'relative grid justify-items-center gap-1 rounded-xl border border-dashed border-border px-4 text-center text-[13px] text-muted-foreground transition-colors duration-150 hover:border-foreground/25 has-focus-visible:ring-3 has-focus-visible:ring-ring/40 data-over:border-primary/50 data-over:bg-muted/50',
        compact ? 'py-5' : 'py-8',
      )}
    >
      <span className="mb-1 flex size-9 items-center justify-center rounded-full ring-1 ring-border">
        <Upload className="size-4 stroke-[1.5]" />
      </span>
      <span>
        <span className="font-medium text-foreground">Drop the receipt here</span> or click to
        choose
      </span>
      <span className="text-xs">PDF or a photo (JPEG, PNG, WebP, HEIC) · up to 20 MB</span>
      <input
        type="file"
        multiple
        accept={RECEIPT_ACCEPT}
        aria-label="Upload receipts"
        disabled={disabled}
        onDragEnter={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > RECEIPT_MAX_FILES)
            toast.error(`Up to ${RECEIPT_MAX_FILES} receipts at once.`)
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
  // Thumbnails for picked photos; the object URLs are released when the files change or the form closes.
  const urls = useMemo(
    () =>
      new Map(
        files
          .filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type))
          .map((file) => [file, URL.createObjectURL(file)]),
      ),
    [files],
  )
  useEffect(
    () => () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
    },
    [urls],
  )
  return (
    <ul className="grid gap-2">
      {files.map((file) => (
        <li
          key={`${file.name}-${file.size}`}
          className="flex items-center gap-3 rounded-lg px-2.5 py-2 ring-1 ring-border"
        >
          {urls.get(file) ? (
            <span className="relative size-10 shrink-0 overflow-hidden rounded-md ring-1 ring-border">
              <Image
                src={urls.get(file) ?? ''}
                alt=""
                fill
                unoptimized
                sizes="40px"
                className="object-cover"
              />
            </span>
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <FileText className="size-4 stroke-[1.5]" />
            </span>
          )}
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="text-[13.5px] break-all">{file.name}</span>
            <span className="text-xs text-muted-foreground">
              {formatFileSize(file.size)} · uploads when you save
            </span>
          </span>
          <Button
            type="button"
            variant="destructive-ghost"
            size="icon-sm"
            aria-label={`Remove ${file.name}`}
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

/** The expense's receipts in its drawer: a large preview of the chosen one, upload with progress, delete on drafts. */
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
          added.length === 1 ? `${added[0]?.name} attached.` : `${added.length} receipts attached.`,
        )
        setChosen(added[0]?.id ?? null)
        void queryClient.invalidateQueries({ queryKey: expenseKeys.receipts(expenseId) })
        void queryClient.invalidateQueries({ queryKey: expenseKeys.detail(expenseId), exact: true })
        void queryClient.invalidateQueries({ queryKey: ['expenses', 'list'] })
      })
      .catch((error: unknown) => {
        if (!promptUpgrade(error)) toast.error(errorMessage(error))
      })
      .finally(() => setUpload(null))
  }

  if (receipts.isPending) return <Loader className="min-h-64" />
  if (receipts.error)
    return (
      <p className="text-[13px] text-muted-foreground">
        The receipts couldn’t be loaded.{' '}
        <button
          type="button"
          className="cursor-pointer underline"
          onClick={() => void receipts.refetch()}
        >
          Try again
        </button>
      </p>
    )

  return (
    <div className="grid gap-3">
      {shown ? (
        <ReceiptPreview expenseId={expenseId} receipt={shown} />
      ) : (
        uploadable && <ReceiptDrop onFiles={send} disabled={upload !== null} />
      )}

      {upload && (
        <output className="grid gap-1.5 rounded-lg px-3 py-2.5 text-[13px] ring-1 ring-border">
          <span className="break-all">
            Uploading{' '}
            {upload.names.length === 1 ? upload.names[0] : `${upload.names.length} receipts`}…
          </span>
          <span className="h-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(upload.progress * 100)}%` }}
            />
          </span>
        </output>
      )}

      {list.length > 0 && (
        <ul className="divide-y divide-border/60">
          {list.map((receipt) => (
            <li key={receipt.id} className="flex items-center gap-3 py-2">
              <button
                type="button"
                onClick={() => setChosen(receipt.id)}
                aria-pressed={receipt.id === shown?.id}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md text-left"
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
                    receipt.id === shown?.id && 'bg-primary text-primary-foreground',
                  )}
                >
                  <ReceiptText className="size-4 stroke-[1.5]" />
                </span>
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="text-[13.5px] break-all">{receipt.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      formatFileSize(receipt.size),
                      formatDate(receipt.created_at),
                      receipt.uploaded_by?.name,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                className="cursor-pointer text-muted-foreground"
              >
                <a href={receiptUrl(expenseId, receipt.id)} aria-label={`Download ${receipt.name}`}>
                  <Download />
                </a>
              </Button>
              {editable && (
                <Button
                  variant="destructive-ghost"
                  size="icon-sm"
                  aria-label={`Delete ${receipt.name}`}
                  className="cursor-pointer"
                  onClick={() => setDeleting(receipt)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && uploadable && (
        <label className="relative inline-flex h-8 w-fit cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted hover:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring/50">
          <Upload className="size-3.5" /> Add another receipt
          <input
            type="file"
            multiple
            accept={RECEIPT_ACCEPT}
            disabled={upload !== null}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])].slice(0, RECEIPT_MAX_FILES)
              event.target.value = ''
              if (files.length) send(files)
            }}
            className="sr-only"
          />
        </label>
      )}

      {deleting && (
        <ConfirmDialog
          key={deleting.id}
          title={`Delete ${deleting.name}?`}
          body="The file is removed from this draft for good."
          confirmLabel="Delete receipt"
          tone="destructive"
          onDecide={(approved) => {
            const receipt = deleting
            setDeleting(null)
            if (approved)
              remove.mutate(receipt.id, {
                onSuccess: () => toast.success(`${receipt.name} deleted.`),
                onError: toastError,
              })
          }}
        />
      )}
    </div>
  )
}

function ReceiptPreview({ expenseId, receipt }: { expenseId: string; receipt: Receipt }) {
  const src = receiptUrl(expenseId, receipt.id, true)
  if (!previewable(receipt.content_type))
    return (
      <a
        href={receiptUrl(expenseId, receipt.id)}
        className="grid cursor-pointer justify-items-center gap-2 rounded-xl px-4 py-10 text-center text-[13px] text-muted-foreground ring-1 ring-border hover:text-foreground"
      >
        <FileText className="size-6 stroke-[1.5]" />
        <span>This photo format has no preview in the browser. Download it to view.</span>
      </a>
    )
  return (
    <figure className="overflow-hidden rounded-xl ring-1 ring-border">
      {receipt.content_type === 'application/pdf' ? (
        <PdfView src={src} title={receipt.name} className="h-[480px]" />
      ) : (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${receipt.name} in a new tab`}
          className="relative block h-[480px] cursor-zoom-in bg-muted/40 dark:bg-background"
        >
          <Image
            src={src}
            alt={receipt.name}
            fill
            unoptimized
            sizes="680px"
            className="object-contain p-3"
          />
        </a>
      )}
    </figure>
  )
}

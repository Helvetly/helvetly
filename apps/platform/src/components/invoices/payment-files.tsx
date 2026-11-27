'use client'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, FolderOpen, Paperclip, Unlink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { recordPageHref, useDrawers } from '@/components/record-link'
import { PdfPicker } from '@/components/signatures/pdf-parts'
import { errorMessage } from '@/lib/api'
import { refreshDocuments, uploadDocument } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import {
  invoiceKeys,
  invoicesApi,
  paymentFilesUrl,
  type MoneyMovementKind,
  type PaymentDocument,
} from '@/lib/invoices'

type Target = { invoiceId: string; kind: MoneyMovementKind; id: string }

/** After a link changes: the invoice's payments and the files' padlocks in Documents. */
function useRefresh(invoiceId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId), exact: true })
    refreshDocuments(queryClient)
  }
}

/** A payment's or refund's linked files, each a chip with its menu: preview, open in Documents, unlink. */
export function PaymentFileChips({
  target,
  documents,
  canEdit,
}: {
  target: Target
  documents: PaymentDocument[]
  canEdit: boolean
}) {
  const drawers = useDrawers()
  const router = useRouter()
  const refresh = useRefresh(target.invoiceId)
  if (!documents.length) return null
  const unlink = async (file: PaymentDocument) => {
    try {
      await invoicesApi.detachPaymentDocument(target.invoiceId, target.kind, target.id, file.id)
      refresh()
      toast.success(translate('paymentFileUnlinked'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <span className="flex flex-wrap gap-1 pt-1.5">
      {documents.map((file) => (
        <DropdownMenu key={file.id}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              className="max-w-full min-w-0 cursor-pointer font-normal"
              aria-label={translate('paymentFileMenu', { name: file.name })}
            >
              <Paperclip />
              <span className="truncate">{file.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <ActionMenuContent
            kind="dropdown"
            menu={{
              header: file.name,
              actions: [
                {
                  id: 'preview',
                  group: 'view',
                  label: translate('paymentFilePreview'),
                  icon: <Eye />,
                  onSelect: () => drawers.open({ kind: 'document', id: file.id }),
                },
                {
                  id: 'open-in-documents',
                  group: 'view',
                  label: translate('openInDocuments'),
                  icon: <FolderOpen />,
                  onSelect: () => router.push(recordPageHref({ kind: 'document', id: file.id })),
                },
                canEdit && {
                  id: 'unlink',
                  group: 'danger',
                  label: translate('paymentFileUnlink'),
                  icon: <Unlink />,
                  onSelect: () => void unlink(file),
                },
              ],
            }}
          />
        </DropdownMenu>
      ))}
    </span>
  )
}

/** The paperclip of a payment row: attach a new upload or a file from Documents. */
export function AttachPaymentFile({ target, label }: { target: Target; label: string }) {
  const [open, setOpen] = useState(false)
  const refresh = useRefresh(target.invoiceId)
  const attached = () => {
    refresh()
    setOpen(false)
    toast.success(translate('paymentFileAttached'))
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate('attachPaymentFileTo', { label })}
            className="text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
            onClick={() => setOpen(true)}
          >
            <Paperclip />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{translate('attachPaymentFile')}</TooltipContent>
      </Tooltip>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>{translate('attachPaymentFile')}</DialogTitle>
              <DialogDescription>{translate('attachPaymentFileHelp')}</DialogDescription>
            </DialogHeader>
            <PdfPicker
              document={null}
              folderId={null}
              upload={async (file, onProgress) => {
                await uploadDocument(
                  file,
                  {
                    folderId: null,
                    url: paymentFilesUrl(target.invoiceId, target.kind, target.id),
                  },
                  onProgress,
                )
                attached()
              }}
              onChoose={(file) => {
                invoicesApi
                  .attachPaymentDocument(target.invoiceId, target.kind, target.id, file.id)
                  .then(attached, (error: unknown) => toast.error(errorMessage(error)))
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

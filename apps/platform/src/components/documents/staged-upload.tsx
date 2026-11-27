'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Info, LoaderCircle } from 'lucide-react'
import { useState } from 'react'

import { FileIcon } from '@/components/import/import-files'
import { useAI } from '@/lib/ai'
import { errorMessage } from '@/lib/api'
import { docsApi, formatSize, refreshDocuments, type DocFile } from '@/lib/documents'
import { translate } from '@/lib/i18n'

import { OrganizeDrawer, readablePath, type StagedFiled } from './organize-drawer'
import { readyBatch, type QueueAction, type Upload } from './upload-queue'

/** Closing with more staged files than this asks first: they are deleted. */
export const CONFIRM_DISCARD_FROM = 3

/**
 * Once every file of a staged upload is up: "Uploaded X files", then "Just upload" (into the folder the person was in,
 * with the usual AI filing) or "AI smart grouping" (a proposed place per file, reviewed in a drawer). Closing deletes
 * the staged files.
 */
export function StagedUpload({
  uploads,
  dispatch,
}: {
  uploads: Upload[]
  dispatch: (action: QueueAction) => void
}) {
  const queryClient = useQueryClient()
  const ai = useAI()
  const batch = readyBatch(uploads)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const staged = batch?.files.flatMap((upload) => (upload.staged ? [upload.staged] : [])) ?? []
  const others = batch?.files.filter((upload) => upload.status !== 'staged') ?? []

  const filed = (batchId: string, documents: DocFile[], pathOf: (id: string) => string) => {
    dispatch({
      type: 'filed',
      batchId,
      filed: Object.fromEntries(
        documents.map((doc) => [doc.id, { result: doc, folderName: pathOf(doc.id) }]),
      ),
    })
    refreshDocuments(queryClient)
    setReviewing(null)
  }
  const justUpload = useMutation({
    mutationFn: async (args: { batchId: string; folderId: string | null; folderName: string }) => ({
      ...args,
      documents: (await docsApi.stagedConfirm(args.batchId, args.folderId)).data.documents,
    }),
    onSuccess: ({ batchId, folderName, documents }) => filed(batchId, documents, () => folderName),
  })
  const discard = useMutation({
    mutationFn: (batchId: string) => docsApi.stagedCancel(batchId).then(() => batchId),
    onSuccess: (batchId) => dispatch({ type: 'discard', batchId }),
  })

  if (!batch) return null
  const { batchId, folderId, folderName } = batch
  const busy = justUpload.isPending || discard.isPending

  if (reviewing === batchId)
    return (
      <OrganizeDrawer
        staged={{ batchId, folderId, files: staged }}
        onApplied={({ documents, paths }: StagedFiled) =>
          filed(batchId, documents, (id) => (paths[id] ? readablePath(paths[id]) : folderName))
        }
        onClose={() => setReviewing(null)}
      />
    )

  const close = () => {
    if (busy) return
    if (staged.length > CONFIRM_DISCARD_FROM) setAsking(true)
    else discard.mutate(batchId)
  }

  return (
    <>
      <Dialog open={!asking} onOpenChange={(open) => !open && close()}>
        <DialogContent className="gap-4 sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{translate('stagedTitle', { count: staged.length })}</DialogTitle>
            <DialogDescription>{translate('stagedLead', { folder: folderName })}</DialogDescription>
          </DialogHeader>
          <ul
            aria-label={translate('stagedFiles')}
            className="max-h-64 divide-y overflow-y-auto rounded-lg border text-body-sm"
          >
            {staged.map((file) => (
              <li key={file.id} className="flex items-center gap-2.5 px-3 py-2">
                <FileIcon name={file.name} className="size-6 stroke-[1.5]" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {formatSize(file.size)}
                </span>
              </li>
            ))}
            {others.map((upload) => (
              <li
                key={upload.id}
                className="flex items-center gap-2.5 px-3 py-2 text-muted-foreground"
              >
                <Info aria-hidden className="size-4 shrink-0" />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate">{upload.file.name}</span>
                  <span className="truncate text-caption">
                    {upload.status === 'duplicate'
                      ? (upload.error ?? translate('alreadyInDocuments'))
                      : upload.status === 'cancelled'
                        ? translate('cancelled')
                        : (upload.error ?? translate('failed'))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {(justUpload.error ?? discard.error) && (
            <Callout tone="danger">{errorMessage(justUpload.error ?? discard.error)}</Callout>
          )}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant={ai.available && ai.consented ? 'outline' : 'default'}
              disabled={busy}
              onClick={() => justUpload.mutate({ batchId, folderId, folderName })}
            >
              {justUpload.isPending && (
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              )}
              {translate('stagedJustUpload')}
            </Button>
            {ai.available && ai.consented && (
              <Button disabled={busy || ai.usedUp} onClick={() => setReviewing(batchId)}>
                <HeidiSparkle />
                {translate('stagedSmartGrouping')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {asking && (
        <ConfirmDialog
          tone="destructive"
          title={translate('stagedDiscardTitle', { count: staged.length })}
          body={translate('stagedDiscardBody')}
          confirmLabel={translate('stagedDiscard')}
          onDecide={(approved) => {
            setAsking(false)
            if (approved) discard.mutate(batchId)
          }}
        />
      )}
    </>
  )
}

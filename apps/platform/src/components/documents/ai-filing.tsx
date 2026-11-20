'use client'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { docsApi, filingSummary, refreshDocuments, type DocFile } from '@/lib/documents'
import { translate } from '@/lib/i18n'

import type { Upload } from './upload-queue'

const POLL_MS = 2_000
/** Filing that takes longer is not waited for: the file stays where it was uploaded meanwhile. */
const GIVE_UP_MS = 90_000

/**
 * Watches the uploads AI filing will sort and, once the batch has landed and been sorted, says in one toast
 * what it did, with Undo. Nothing is said when filing skipped them (no allowance left, for one). `onAnnounce`
 * runs first: the finished upload tray makes way for the toast.
 */
export function useAIFilingToast(uploads: Upload[], onAnnounce?: () => void) {
  const queryClient = useQueryClient()
  const seen = useRef(new Set<string>())
  const sorted = useRef<DocFile[]>([])
  const [waiting, setWaiting] = useState(new Map<string, number>()) // id → since
  const uploading = uploads.some((u) => u.status === 'queued' || u.status === 'uploading')

  useEffect(() => {
    const fresh = uploads.flatMap((u) =>
      u.result?.ai_filing?.status === 'queued' && !seen.current.has(u.result.id)
        ? [u.result.id]
        : [],
    )
    if (fresh.length === 0) return
    for (const id of fresh) seen.current.add(id)
    setWaiting((current) => new Map([...current, ...fresh.map((id) => [id, Date.now()] as const)]))
  }, [uploads])

  useEffect(() => {
    if (waiting.size === 0) return
    const poll = async () => {
      const ids = [...waiting.keys()]
      const answers = await Promise.allSettled(ids.map((id) => docsApi.get(id)))
      const next = new Map(waiting)
      answers.forEach((answer, i) => {
        const id = ids[i] ?? ''
        if (answer.status === 'rejected') next.delete(id) // gone meanwhile
        else if (answer.value.data.ai_filing?.status !== 'queued') {
          sorted.current.push(answer.value.data)
          next.delete(id)
        } else if (Date.now() - (waiting.get(id) ?? 0) > GIVE_UP_MS) next.delete(id)
      })
      setWaiting(next) // a new map, so the next poll is scheduled while any remain
    }
    const timer = setTimeout(() => void poll(), POLL_MS)
    return () => clearTimeout(timer)
  }, [waiting])

  useEffect(() => {
    if (uploading || waiting.size > 0 || sorted.current.length === 0) return
    const batch = sorted.current
    sorted.current = []
    refreshDocuments(queryClient)
    if (filingSummary(batch).filed.length > 0) onAnnounce?.()
    announceFiling(batch, queryClient)
  }, [uploading, waiting, queryClient, onAnnounce])
}

/** "Filed 3 files into Invoices", with Undo that puts them back and removes the tags filing added. */
export function announceFiling(files: DocFile[], queryClient: QueryClient) {
  const { filed, moved, folders, folder } = filingSummary(files)
  const count = filed.length
  if (count === 0) return
  const message =
    folder && moved === count
      ? translate('aiFiledInto', { count, folder })
      : moved > 0
        ? translate('aiFiledIntoFolders', { count, folders })
        : translate('aiTagged', { count })
  toast.success(message, {
    action: {
      label: translate('undo'),
      onClick: () =>
        void Promise.all(filed.map((file) => docsApi.undoFiling(file.id)))
          .then(() => toast.success(translate('aiFilingUndone', { count })), toastError)
          .finally(() => refreshDocuments(queryClient)),
    },
  })
}

/** The quiet "Sorted by AI" mark of a file filing moved or tagged. */
export function SortedByAI({ file, className }: { file: DocFile; className?: string }) {
  if (file.ai_filing?.status !== 'filed') return null
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn('inline-flex shrink-0 items-center text-muted-foreground', className)}
          >
            <Sparkles aria-hidden className="size-3" />
            <span className="sr-only">{translate('sortedByAI')}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{translate('sortedByAI')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** A file's tags as small chips, at most `max` with "+n" for the rest. */
export function TagChips({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return null
  const rest = tags.length - max
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {tags.slice(0, max).map((tag) => (
        <span
          key={tag}
          className="h-[18px] shrink-0 truncate rounded-sm bg-muted px-1.5 text-caption leading-[18px] text-foreground/80"
        >
          {tag}
        </span>
      ))}
      {rest > 0 && <span className="shrink-0 text-caption">+{rest}</span>}
    </span>
  )
}

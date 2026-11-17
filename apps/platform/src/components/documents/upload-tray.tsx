'use client'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  ChevronDown,
  CopyPlus,
  Loader2,
  RefreshCw,
  Replace,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'

import { promptUpgrade } from '@/components/billing/upgrade-prompt'
import { ApiError, errorMessage } from '@/lib/api'
import { formatSize, refreshDocuments, uploadDocument, type OnConflict } from '@/lib/documents'
import { translate } from '@/lib/i18n'

import { kindFromName, KindIcon } from './kind'
import {
  newUploads,
  nextToStart,
  queueReducer,
  summarize,
  type QueueAction,
  type Upload,
} from './upload-queue'

/** The upload queue: adds files, runs a few at a time, and refreshes the lists as files land. */
export function useUploads() {
  const queryClient = useQueryClient()
  const [uploads, dispatch] = useReducer(queueReducer, [])
  const controllers = useRef(new Map<string, AbortController>())

  useEffect(() => {
    for (const upload of nextToStart(uploads)) {
      if (controllers.current.has(upload.id)) continue // already started (effects can run twice)
      const controller = new AbortController()
      controllers.current.set(upload.id, controller)
      dispatch({ type: 'start', id: upload.id })
      uploadDocument(
        upload.file,
        { folderId: upload.folderId, onConflict: upload.onConflict },
        (progress) => dispatch({ type: 'progress', id: upload.id, progress }),
        controller.signal,
      )
        .then((result) => {
          dispatch({ type: 'done', id: upload.id, result })
          refreshDocuments(queryClient)
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          if (error instanceof ApiError && error.code === 'name_taken') {
            const suggestion = error.details.suggestion
            dispatch({
              type: 'conflict',
              id: upload.id,
              suggestion: typeof suggestion === 'string' ? suggestion : '',
            })
          } else {
            promptUpgrade(error)
            dispatch({ type: 'failed', id: upload.id, error: uploadError(error) })
          }
        })
        .finally(() => controllers.current.delete(upload.id))
    }
  }, [uploads, queryClient])

  const act = (action: QueueAction) => {
    if (action.type === 'cancel') controllers.current.get(action.id)?.abort()
    dispatch(action)
  }
  const add = (files: File[], folderId: string | null, folderName: string) =>
    dispatch({ type: 'add', uploads: newUploads(files, folderId, folderName) })
  const clear = useCallback(() => dispatch({ type: 'clear' }), [])
  return { uploads, add, act, clear }
}

/** The server's sentence about the file ("… is not a supported file"), not the generic one. */
function uploadError(error: unknown) {
  if (error instanceof ApiError) {
    const fields = error.details.fields
    if (typeof fields === 'object' && fields !== null) {
      const first = Object.values(fields).find((value) => typeof value === 'string')
      if (typeof first === 'string') return first
    }
  }
  return errorMessage(error)
}

const STATUS_TEXT: Record<Upload['status'], string> = {
  queued: translate('waiting'),
  uploading: translate('uploading'),
  done: translate('uploaded2'),
  failed: translate('failed'),
  conflict: translate('nameTaken'),
  cancelled: translate('cancelled'),
}

/** Bottom right: every upload with its progress, and what to do about clashes and failures. */
export function UploadTray({
  uploads,
  act,
}: {
  uploads: Upload[]
  act: (action: QueueAction) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  if (uploads.length === 0) return null
  const sum = summarize(uploads)
  const finished = sum.active === 0 && sum.conflicts === 0
  const title =
    sum.active > 0
      ? translate('uploading2', { active: sum.active, value2: sum.active === 1 ? 'file' : 'files' })
      : sum.conflicts > 0
        ? translate('dynamicTaken', {
            conflicts: sum.conflicts,
            value2: sum.conflicts === 1 ? translate('nameIs') : translate('namesAre'),
          })
        : sum.failed > 0
          ? translate('uploadedFailed', { done: sum.done, failed: sum.failed })
          : translate('dynamicComplete', {
              done: sum.done,
              value2: sum.done === 1 ? translate('dynamicUpload') : translate('dynamicUploads'),
            })

  return (
    <section
      aria-label={translate('uploads')}
      className="fixed right-4 bottom-4 z-40 w-[360px] max-w-[calc(100vw-2rem)] animate-in overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-elevation-2 duration-200 fade-in slide-in-from-bottom-2"
    >
      <header className="flex h-12 items-center gap-2 border-b px-3">
        <span className="flex size-6 items-center justify-center">
          {sum.active > 0 ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : sum.failed > 0 || sum.conflicts > 0 ? (
            <AlertCircle className="size-4 text-[#a05c5c] dark:text-rose-300" />
          ) : (
            <Check className="size-4 text-success-solid" />
          )}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium" aria-live="polite">
          {title}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? translate('showUploads') : translate('hideUploads')}
          aria-expanded={!collapsed}
          className="cursor-pointer"
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronDown className={cn('transition-transform', collapsed && 'rotate-180')} />
        </Button>
        {finished && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={translate('close')}
            className="cursor-pointer"
            onClick={() => act({ type: 'clear' })}
          >
            <X />
          </Button>
        )}
      </header>
      {sum.active > 0 && (
        <div aria-hidden className="h-0.5 bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${sum.progress * 100}%` }}
          />
        </div>
      )}
      {!collapsed && (
        <>
          {sum.conflicts > 1 && (
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-[13px]">
              <span className="flex-1 text-muted-foreground">{translate('forAllClashes')}</span>
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                onClick={() => act({ type: 'resolveAll', onConflict: 'keep_both' })}
              >
                {translate('keepBoth')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                onClick={() => act({ type: 'resolveAll', onConflict: 'replace' })}
              >
                {translate('replace2')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="cursor-pointer"
                onClick={() => act({ type: 'resolveAll', onConflict: 'skip' })}
              >
                {translate('skip')}
              </Button>
            </div>
          )}
          <ul className="max-h-[300px] divide-y overflow-y-auto">
            {uploads.map((upload) => (
              <UploadRow key={upload.id} upload={upload} act={act} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function UploadRow({ upload, act }: { upload: Upload; act: (action: QueueAction) => void }) {
  const retry = (onConflict?: OnConflict) => act({ type: 'retry', id: upload.id, onConflict })
  const running = upload.status === 'queued' || upload.status === 'uploading'
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <KindIcon kind={kindFromName(upload.file.name)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px]" title={upload.file.name}>
            {upload.result?.name ?? upload.file.name}
          </p>
          <p
            className={cn(
              'truncate text-[12px] text-muted-foreground',
              upload.status === 'failed' && 'text-[#a05c5c] dark:text-rose-300',
            )}
          >
            {upload.status === 'failed'
              ? upload.error
              : upload.status === 'conflict'
                ? translate('isAlreadyIn', {
                    name: upload.file.name,
                    folderName: upload.folderName,
                  })
                : upload.status === 'uploading'
                  ? translate('dynamicOf2', {
                      value1: formatSize(upload.file.size * upload.progress),
                      value2: formatSize(upload.file.size),
                    })
                  : `${STATUS_TEXT[upload.status]} · ${upload.folderName}`}
          </p>
        </div>
        {upload.status === 'done' && (
          <Check
            aria-label={translate('uploaded2')}
            className="size-4 shrink-0 text-success-solid"
          />
        )}
        {upload.status === 'failed' && (
          <TrayIcon label={translate('retry')} onClick={() => retry()}>
            <RefreshCw />
          </TrayIcon>
        )}
        {running && (
          <TrayIcon
            label={translate('cancel')}
            onClick={() => act({ type: 'cancel', id: upload.id })}
          >
            <X />
          </TrayIcon>
        )}
      </div>
      {upload.status === 'uploading' && (
        <div className="ml-[38px] h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${upload.progress * 100}%` }}
          />
        </div>
      )}
      {upload.status === 'conflict' && (
        <div className="ml-[38px] flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer gap-1"
            title={
              upload.suggestion
                ? translate('uploadAs', { suggestion: upload.suggestion })
                : undefined
            }
            onClick={() => retry('keep_both')}
          >
            <CopyPlus className="size-3.5" />
            {translate('keepBoth')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer gap-1"
            onClick={() => retry('replace')}
          >
            <Replace className="size-3.5" />
            {translate('replace2')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="cursor-pointer"
            onClick={() => act({ type: 'cancel', id: upload.id })}
          >
            {translate('skip')}
          </Button>
        </div>
      )}
    </li>
  )
}

function TrayIcon({
  label,
  onClick,
  children,
}: {
  label: string
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
          className="cursor-pointer text-muted-foreground"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

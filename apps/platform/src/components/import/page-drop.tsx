'use client'

import { Button } from '@helvetly/ui/components/button'
import { FileUp, Upload } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { handOffImport } from '@/components/import/hand-off'
import { useImportDrawer } from '@/components/import/import-button'
import { addFiles } from '@/components/import/import-files'
import { isHeic } from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import type { ImportKind } from '@/lib/imports'

/** What a window drag event does to the count of elements the dragged files are over. */
export type DragSignal = 'enter' | 'over' | 'leave' | 'reset'

export function nextDragDepth(depth: number, signal: DragSignal) {
  if (signal === 'enter') return depth + 1
  if (signal === 'leave') return Math.max(0, depth - 1)
  // A dragover means the files are over the page, whatever enter and leave events went missing.
  if (signal === 'over') return Math.max(1, depth)
  return 0
}

/**
 * Whether files are being dragged over the window; dropping them anywhere calls onFiles, unless an
 * inner drop target handled the drop and stopped it. While enabled the browser never opens a
 * dropped file, and the flag resets on drop, drag end, leaving the window, Escape, blur and hiding.
 */
export function useFileDrop(enabled: boolean, onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const drop = useEffectEvent(onFiles)
  useEffect(() => {
    if (!enabled) return
    let depth = 0
    let exit: ReturnType<typeof setTimeout> | undefined
    const signal = (next: DragSignal) => {
      clearTimeout(exit)
      depth = nextDragDepth(depth, next)
      setOver(depth > 0)
    }
    const reset = () => signal('reset')
    // 'Files' is the DataTransfer type of files from the desktop, the same in every language.
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const enter = (event: DragEvent) => {
      if (hasFiles(event)) signal('enter')
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      signal('leave')
      // No related target: the pointer left the window (some browsers never set one, so the
      // next dragover inside cancels this).
      if (event.relatedTarget === null) exit = setTimeout(reset, 150)
    }
    // Capture phase, so no inner element can let the browser open the file instead.
    const overEvent = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      signal('over')
    }
    const dropCapture = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      reset()
    }
    // Bubble phase: an inner drop target (a folder) that handled the drop stopped it before here.
    const dropEvent = (event: DragEvent) => {
      if (hasFiles(event)) drop([...(event.dataTransfer?.files ?? [])])
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset()
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') reset()
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overEvent, true)
    window.addEventListener('drop', dropCapture, true)
    window.addEventListener('drop', dropEvent)
    window.addEventListener('dragend', reset)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      clearTimeout(exit)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overEvent, true)
      window.removeEventListener('drop', dropCapture, true)
      window.removeEventListener('drop', dropEvent)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', hidden)
      setOver(false)
    }
  }, [enabled])
  return over
}

/**
 * Files dropped anywhere on a list page start that page's AI import with them chosen: the same
 * drawer (and so the same upload, checks and review) as its Import entry. Off while the drawer is open.
 */
export function useImportDrop(kind: ImportKind, enabled: boolean) {
  const drawer = useImportDrawer()
  const start = (dropped: File[]) => {
    const heic = dropped.filter(isHeic)
    if (heic.length)
      toast.error(
        translate('heicPhotosCanTBeReadByTheAI', {
          value1: heic.map((file) => file.name).join(', '),
        }),
      )
    const { files, note } = addFiles(
      [],
      dropped.filter((file) => !isHeic(file)),
    )
    if (note) toast.error(note)
    if (!files.length) return
    handOffImport(kind, files)
    drawer.open()
  }
  return useFileDrop(enabled && !drawer.isOpen, start)
}

/** Covers the page while files are dragged over it, saying what a drop does. */
export function DropOverlay({ title }: { title: string }) {
  return (
    <div
      aria-hidden
      data-slot="drop-overlay"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-[2px]"
    >
      <div className="grid justify-items-center gap-3 drop-zone bg-card px-12 py-10 text-center shadow-elevation-2">
        <Upload className="size-6 stroke-[1.5] text-brand" />
        <p className="text-title-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">
          {translate('pdfPhotosOrSpreadsheetsUpTo25FilesOf')}
        </p>
      </div>
    </div>
  )
}

/**
 * An empty list's buttons: its own first action, then Import and the hint that a drop works too,
 * or the first action alone without `onImport` (no import for this person or plan).
 */
export function EmptyImportActions({
  children,
  importLabel,
  hint,
  onImport,
}: {
  children: ReactNode
  importLabel: string
  hint: string
  onImport: (() => void) | undefined
}) {
  if (!onImport) return children
  return (
    <>
      <div className="flex flex-wrap justify-center gap-2">
        {children}
        <Button variant="outline" size="sm" className="cursor-pointer" onClick={onImport}>
          <FileUp />
          {importLabel}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{hint}</p>
    </>
  )
}

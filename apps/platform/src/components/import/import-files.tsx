'use client'

import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatFileSize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { AlertCircle, CheckCircle2, Clock, FileText, Loader2, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  IMPORT_ACCEPT,
  IMPORT_FILE_TYPES,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILES,
  type ImportFile,
} from '@/lib/imports'
import { MAX_REQUEST_BYTES } from '@/lib/upload-packs'

const sameFile = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified

/** Adds `picked` to `chosen`: no repeats, at most 10, none over 25 MB, 95 MB in all; says what it left out. */
export function addFiles(chosen: File[], picked: File[]): { files: File[]; note: string | null } {
  const files = [...chosen]
  const notes: string[] = []
  for (const file of picked) {
    if (files.some((entry) => sameFile(entry, file))) continue
    const total = files.reduce((sum, entry) => sum + entry.size, file.size)
    if (file.size > MAX_IMPORT_FILE_BYTES) notes.push(`${file.name} is over 25 MB.`)
    else if (total > MAX_REQUEST_BYTES) notes.push(`${file.name} would take the upload over 95 MB.`)
    else if (files.length >= MAX_IMPORT_FILES) {
      notes.push(`Up to ${MAX_IMPORT_FILES} files at a time.`)
      break
    } else files.push(file)
  }
  return { files, note: notes.length ? notes.join(' ') : null }
}

/** Click or drop files; the chosen ones are listed under it until "Read files". */
export function DropZone({
  files,
  disabled,
  onChange,
}: {
  files: File[]
  disabled: boolean
  onChange: (files: File[]) => void
}) {
  const [over, setOver] = useState(false)
  const add = (picked: File[]) => {
    const next = addFiles(files, picked)
    // A toast, not an inline line, so a refused file does not move the list below.
    if (next.note) toast.error(next.note)
    onChange(next.files)
  }

  return (
    <div className="grid gap-3">
      {/* The input covers the zone, so clicking or dropping on it is the browser's own behaviour. */}
      <div
        data-over={over || undefined}
        className="relative flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors duration-150 has-focus-visible:ring-3 has-focus-visible:ring-ring/40 data-over:border-primary/50 data-over:bg-muted"
      >
        <Upload className="size-5 stroke-[1.5] text-muted-foreground" />
        <p className="text-[14px] font-medium">Drop files here or click to choose</p>
        <p className="max-w-[46ch] text-[12.5px] text-pretty text-muted-foreground">
          {IMPORT_FILE_TYPES}. Up to {MAX_IMPORT_FILES} files of 25 MB each, 95 MB in all; a ZIP is
          opened one level deep.
        </p>
        <input
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          aria-label="Choose files to import"
          disabled={disabled}
          onDragEnter={() => setOver(true)}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])]
            event.target.value = ''
            add(picked)
          }}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>
      {files.length > 0 && (
        <ul aria-label="Chosen files" className="grid divide-y rounded-lg border">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="flex items-center gap-2 px-3 py-1.5 text-[13px]"
            >
              <FileText className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                {formatFileSize(file.size)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive-ghost"
                    size="icon-xs"
                    aria-label={`Remove ${file.name}`}
                    disabled={disabled}
                    onClick={() => onChange(files.filter((entry) => entry !== file))}
                  >
                    <X />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function fileStatus(file: ImportFile, records: number) {
  switch (file.status) {
    case 'queued':
      return 'Waiting'
    case 'extracting':
      return file.chunks_total
        ? `Reading part ${file.chunks_done} of ${file.chunks_total}`
        : 'Reading'
    case 'done':
      return `${records} ${records === 1 ? 'record' : 'records'} found`
    case 'failed':
      return file.error ?? 'Could not be read'
  }
}

const ICONS = {
  queued: <Clock className="text-muted-foreground" />,
  extracting: <Loader2 className="animate-spin text-muted-foreground motion-reduce:animate-none" />,
  done: <CheckCircle2 className="text-success-solid" />,
  failed: <AlertCircle className="text-destructive" />,
}

/** One line per file the server is reading, or has read. */
export function FileProgress({
  files,
  recordsPerFile,
}: {
  files: ImportFile[]
  recordsPerFile: Map<string, number>
}) {
  return (
    <ul aria-label="Files" className="grid divide-y rounded-lg border">
      {files.map((file) => (
        <li
          key={file.id}
          className="flex items-start gap-2 px-3 py-2 text-[13px] [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]"
        >
          {ICONS[file.status]}
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate">{file.name}</span>
            <span
              className={cn(
                'text-[12px]',
                file.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {fileStatus(file, recordsPerFile.get(file.id) ?? 0)}
              {file.reused && ' · already in Documents, not stored again'}
            </span>
          </div>
          <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
            {formatFileSize(file.size)}
          </span>
        </li>
      ))}
    </ul>
  )
}

'use client'
import { Button, buttonVariants } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatFileSize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  ListChecks,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'
import {
  DOCUMENT_TYPES,
  IMPORT_ACCEPT,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILES,
  type ImportFile,
} from '@/lib/imports'
import { MAX_REQUEST_BYTES } from '@/lib/upload-packs'

/** File formats, not words: the same in every language. */
const IMPORT_TYPE_CHIPS = ['PDF', 'PNG', 'JPEG', 'WEBP', 'XLSX', 'DOCX', 'CSV', 'TXT', 'ZIP']

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
        className="group relative flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors duration-150 not-has-disabled:hover:border-primary/40 not-has-disabled:hover:bg-muted/60 has-focus-visible:ring-3 has-focus-visible:ring-ring/40 data-over:border-primary/60 data-over:bg-primary/5"
      >
        <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary transition-colors duration-150 group-data-over:text-primary">
          <Upload className="size-5 stroke-[1.5]" />
        </span>
        <div className="grid gap-1">
          <p className="text-title-sm font-medium">{translate('importDropTitle')}</p>
          <p className="text-caption text-muted-foreground">
            {translate('importLimits', { count: MAX_IMPORT_FILES })}
          </p>
        </div>
        {/* Looks like a button; the input above it takes the click. */}
        <span aria-hidden className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {translate('chooseFiles')}
        </span>
        <ul
          aria-label={translate('importFileTypes')}
          className="flex flex-wrap justify-center gap-1.5"
        >
          {IMPORT_TYPE_CHIPS.map((type) => (
            <li
              key={type}
              className="rounded-md border bg-background px-1.5 py-0.5 text-caption font-medium tracking-wide text-muted-foreground"
            >
              {type}
            </li>
          ))}
        </ul>
        <input
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          aria-label={translate('chooseFilesToImport')}
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
        <ul aria-label={translate('chosenFiles')} className="grid divide-y rounded-lg border">
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
                    aria-label={translate('remove2', { name: file.name })}
                    disabled={disabled}
                    onClick={() => onChange(files.filter((entry) => entry !== file))}
                  >
                    <X />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translate('remove7')}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** What happens after the drop, in three steps; `suggests` names what the AI looks for. */
export function ImportSteps({ suggests }: { suggests: string }) {
  const steps = [
    { icon: <Upload />, title: translate('importStepDrop'), text: translate('importStepDropText') },
    { icon: <Sparkles />, title: translate('importStepRead'), text: suggests },
    {
      icon: <ListChecks />,
      title: translate('importStepCheck'),
      text: translate('importReviewFirst'),
    },
  ]
  return (
    <ol aria-label={translate('howImportWorks')} className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="grid content-start gap-2 rounded-lg border p-3">
          <span className="flex items-center gap-2 text-body-sm font-medium">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3.5 [&_svg]:stroke-[1.75]">
              {step.icon}
            </span>
            <span className="sr-only">{index + 1}. </span>
            {step.title}
          </span>
          <p className="text-caption text-pretty text-muted-foreground">{step.text}</p>
        </li>
      ))}
    </ol>
  )
}

function fileStatus(file: ImportFile, records: number) {
  switch (file.status) {
    case 'queued':
      return translate('waiting')
    case 'extracting':
      return file.chunks_total
        ? translate('readingPartOf', {
            chunks_done: file.chunks_done,
            chunks_total: file.chunks_total,
          })
        : translate('reading')
    case 'done':
      return translate('dynamicFound', {
        records: records,
        value2: records === 1 ? 'record' : 'records',
      })
    case 'failed':
      return file.error ?? translate('couldNotBeRead')
  }
}

/** Each state its own tinted chip, so reading, waiting, done and failed never look alike. */
const CHIPS = {
  queued: {
    icon: <Clock />,
    chip: 'bg-muted text-muted-foreground',
    text: 'text-muted-foreground',
  },
  extracting: {
    icon: <Loader2 className="animate-spin motion-reduce:animate-none" />,
    chip: 'bg-info-surface text-info',
    text: 'text-info',
  },
  done: { icon: <CheckCircle2 />, chip: 'bg-success-surface text-success', text: 'text-success' },
  failed: {
    icon: <AlertCircle />,
    chip: 'bg-destructive-surface text-destructive',
    text: 'text-destructive',
  },
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
    <ul aria-label={translate('files')} className="grid divide-y rounded-lg border">
      {files.map((file) => (
        <li
          key={file.id}
          data-status={file.status}
          className="flex items-start gap-3 px-3 py-2 text-[13px]"
        >
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-4 [&_svg]:stroke-[1.75]',
              CHIPS[file.status].chip,
            )}
          >
            {CHIPS[file.status].icon}
          </span>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate">{file.name}</span>
            <span className={cn('text-[12px]', CHIPS[file.status].text)}>
              {file.document_type && file.document_type !== 'other' && (
                <span className="font-medium text-foreground">
                  {DOCUMENT_TYPES[file.document_type]} ·{' '}
                </span>
              )}
              {fileStatus(file, recordsPerFile.get(file.id) ?? 0)}
              {file.reused && translate('alreadyInDocumentsNotStoredAgain')}
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

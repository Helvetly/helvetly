'use client'
import { Button, buttonVariants } from '@helvetly/ui/components/button'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Meter } from '@helvetly/ui/components/meter'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatFileSize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  AlertCircle,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileType,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  ListChecks,
  Plus,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'
import {
  DOCUMENT_TYPES,
  fileErrorText,
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

/** Click or drop files; the chosen ones are listed under it, and the zone shrinks to a bar. */
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

  const picked = files.length > 0
  const removeButton = (file: File) => (
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
  )
  const input = (
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
        const chosen = [...(event.target.files ?? [])]
        event.target.value = ''
        add(chosen)
      }}
      className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
    />
  )

  return (
    <div className="grid gap-4">
      {/* The input covers the zone, so clicking or dropping on it is the browser's own behaviour. */}
      <div
        data-over={over || undefined}
        className={cn(
          'group relative flex rounded-xl border border-dashed border-border bg-muted/40 transition-colors duration-150 not-has-disabled:hover:border-primary/40 not-has-disabled:hover:bg-muted/60 has-focus-visible:ring-3 has-focus-visible:ring-ring/40 data-over:border-brand-solid/45 data-over:bg-brand-surface/70',
          picked
            ? 'items-center gap-3 px-4 py-3 text-left'
            : 'flex-col items-center gap-3 px-6 py-10 text-center',
        )}
      >
        <span
          className={cn(
            'grid shrink-0 place-items-center rounded-full bg-brand-surface text-brand',
            picked ? 'size-9 [&_svg]:size-4' : 'size-12 [&_svg]:size-5',
          )}
        >
          <Upload className="stroke-[1.5]" />
        </span>
        <div className={cn('grid gap-1', picked && 'min-w-0 flex-1 gap-0')}>
          <p className={cn('font-medium', picked ? 'text-body-sm' : 'text-title-sm')}>
            {picked ? translate('importDropMore') : translate('importDropTitle')}
          </p>
          <p className="text-caption text-muted-foreground">
            {translate('importLimits', { count: MAX_IMPORT_FILES })}
          </p>
        </div>
        {/* Looks like a button; the input above it takes the click. */}
        <span
          aria-hidden
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
        >
          {picked ? <Plus /> : null}
          {picked ? translate('addFiles') : translate('chooseFiles')}
        </span>
        {!picked && (
          <ul
            aria-label={translate('importFileTypes')}
            className="flex flex-wrap justify-center gap-1.5"
          >
            {IMPORT_TYPE_CHIPS.map((type) => (
              <li
                key={type}
                className="rounded-md border bg-card px-1.5 py-0.5 text-caption font-medium tracking-wide text-muted-foreground"
              >
                {type}
              </li>
            ))}
          </ul>
        )}
        {input}
      </div>
      {picked && (
        // The same table as the review's, so the files keep their place when reading starts.
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table aria-label={translate('chosenFiles')} className="w-full text-left text-body-sm">
            <thead className="border-b bg-muted/40 text-caption text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {translate('document')}
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  {translate('importFileType')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {translate('importFileSize')}
                </th>
                <th scope="col" className="w-24 px-2 py-1 text-right">
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={disabled}
                    onClick={() => onChange([])}
                  >
                    {translate('removeAllFiles')}
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {files.map((file) => (
                <tr key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <td className="max-w-0 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <FileIcon name={file.name} />
                      <span className="truncate">{file.name}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                    {kindOf(file.name).label()}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatFileSize(file.size)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="flex justify-end">{removeButton(file)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** The kinds of file an import takes, each with its icon, tint and name. */
const FILE_KINDS = [
  {
    test: /\.pdf$/i,
    icon: FileText,
    tint: 'text-destructive',
    label: () => translate('importKindPdf'),
  },
  {
    test: /\.(png|jpe?g|webp)$/i,
    icon: FileImage,
    tint: 'text-info',
    label: () => translate('importKindImage'),
  },
  {
    test: /\.(xlsx|xls|csv)$/i,
    icon: FileSpreadsheet,
    tint: 'text-success',
    label: () => translate('importKindSheet'),
  },
  {
    test: /\.docx?$/i,
    icon: FileType,
    tint: 'text-info',
    label: () => translate('importKindWord'),
  },
  {
    test: /\.zip$/i,
    icon: FileArchive,
    tint: 'text-warning',
    label: () => translate('importKindZip'),
  },
]

const kindOf = (name: string) =>
  FILE_KINDS.find((kind) => kind.test.test(name)) ?? {
    icon: File,
    tint: 'text-muted-foreground',
    label: () => translate('importKindText'),
  }

/** A file's icon, tinted by its kind (PDF, photo, spreadsheet, Word, ZIP), so a mixed batch scans at a glance. */
export function FileIcon({ name, className }: { name: string; className?: string }) {
  const { icon: Icon, tint } = kindOf(name)
  return <Icon aria-hidden className={cn('size-4 shrink-0 stroke-[1.75]', tint, className)} />
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
      return file.chunks_total && file.chunks_total > 1
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
      return file.error ? fileErrorText(file.error) : translate('couldNotBeRead')
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

/** A file's state chip, name, what is happening to it and its size, in one line. */
export function FileLine({ file, records }: { file: ImportFile; records: number }) {
  return (
    <>
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-4 [&_svg]:stroke-[1.75]',
          CHIPS[file.status].chip,
        )}
      >
        {CHIPS[file.status].icon}
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-medium">{file.name}</span>
        <span className={cn('text-caption', CHIPS[file.status].text)}>
          {file.document_type && file.document_type !== 'other' && (
            <span className="font-medium text-foreground">
              {DOCUMENT_TYPES[file.document_type]} ·{' '}
            </span>
          )}
          {fileStatus(file, records)}
          {file.reused && translate('alreadyInDocumentsNotStoredAgain')}
        </span>
      </span>
      <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
        {formatFileSize(file.size)}
      </span>
    </>
  )
}

/**
 * The import's files as one table: a row per file (state, name, size), its rows read from it opening beneath.
 * `header` heads the table (a select-all).
 */
export function FileProgress({
  files,
  recordsPerFile,
  header,
  children,
}: {
  files: ImportFile[]
  recordsPerFile: Map<string, number>
  header?: ReactNode
  children?: (file: ImportFile) => ReactNode
}) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) =>
    setClosed((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <div className="rounded-lg border bg-card">
      {header && (
        <div className="flex items-center gap-3 rounded-t-lg border-b bg-muted/40 px-3 py-2 text-caption text-muted-foreground">
          {header}
        </div>
      )}
      <ul
        aria-label={translate('files')}
        // No overflow clip on the frame (focus rings show); the last open row rounds itself.
        className="divide-y [&>li:last-child>[id]]:rounded-b-lg"
      >
        {files.map((file) => {
          const found = children?.(file)
          const open = Boolean(found) && !closed.has(file.id)
          const head = <FileLine file={file} records={recordsPerFile.get(file.id) ?? 0} />
          return (
            <li key={file.id} data-status={file.status}>
              <div className="flex items-center gap-3 px-3 py-2 text-body-sm">
                {found ? (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`${file.id}-rows`}
                    onClick={() => toggle(file.id)}
                    className="-my-2 flex min-w-0 flex-1 items-center gap-3 py-2 text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                        open && 'rotate-90',
                      )}
                    />
                    {head}
                  </button>
                ) : (
                  <>
                    {/* Where a file with rows has its chevron, so names line up. */}
                    <span aria-hidden className="size-4 shrink-0" />
                    {head}
                  </>
                )}
              </div>
              {found && (
                <div id={`${file.id}-rows`} hidden={!open} className="border-t bg-muted/20 pl-7">
                  {found}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The import's progress while files are read: how many are done, on a bar. */
export function ReadingProgress({ done, total }: { done: number; total: number }) {
  return (
    <div className="grid gap-2.5 rounded-xl border bg-heidi-soft/40 p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-heidi-soft">
          <HeidiSparkle animated />
        </span>
        <div className="grid min-w-0 flex-1">
          <p className="text-body-sm font-medium">
            {translate('importReadingTitle', { done, total })}
          </p>
          <p className="text-caption text-pretty text-muted-foreground">
            {translate('importReadingHint')}
          </p>
        </div>
      </div>
      <Meter
        value={done}
        max={total}
        tone="brand"
        label={translate('importReadingTitle', { done, total })}
      />
    </div>
  )
}

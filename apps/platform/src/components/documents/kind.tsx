import { IconTile } from '@helvetly/ui/components/icon-tile'
import { cn } from '@helvetly/ui/lib/utils'
import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Presentation,
  type LucideIcon,
} from 'lucide-react'

import type { Kind } from '@/lib/documents'

// The four common kinds get a pastel tile in their usual colour (images amber: violet is Heidi's);
// the rest stay neutral. Chart shares are steps of one grey.
const NEUTRAL = 'bg-muted text-muted-foreground'

/** Each kind's icon, its tile and the grey step of its share in charts. */
export const KIND_STYLE: Record<
  Kind,
  { icon: LucideIcon; tint: string; bar: string; ext: string }
> = {
  pdf: {
    icon: FileText,
    tint: 'bg-destructive-surface text-destructive',
    bar: 'bg-foreground/70',
    ext: 'PDF',
  },
  image: {
    icon: FileImage,
    tint: 'bg-warning-surface text-warning',
    bar: 'bg-foreground/58',
    ext: 'IMG',
  },
  spreadsheet: {
    icon: FileSpreadsheet,
    tint: 'bg-success-surface text-success',
    bar: 'bg-foreground/46',
    ext: 'XLS',
  },
  document: {
    icon: FileText,
    tint: 'bg-info-surface text-info',
    bar: 'bg-foreground/36',
    ext: 'DOC',
  },
  presentation: {
    icon: Presentation,
    tint: NEUTRAL,
    bar: 'bg-foreground/28',
    ext: 'PPT',
  },
  text: {
    icon: FileCode,
    tint: NEUTRAL,
    bar: 'bg-foreground/21',
    ext: 'TXT',
  },
  archive: {
    icon: FileArchive,
    tint: NEUTRAL,
    bar: 'bg-foreground/15',
    ext: 'ZIP',
  },
  other: {
    icon: File,
    tint: NEUTRAL,
    bar: 'bg-foreground/10',
    ext: 'FILE',
  },
}

const EXTENSION_KINDS: Record<string, Kind> = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
  docx: 'document',
  doc: 'document',
  odt: 'document',
  pptx: 'presentation',
  odp: 'presentation',
  txt: 'text',
  md: 'text',
  json: 'text',
  xml: 'text',
  zip: 'archive',
}

/** A kind guessed from a file name, for files not uploaded yet. */
export const kindFromName = (name: string): Kind =>
  EXTENSION_KINDS[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'other'

/** A kind from a stored content type (the Trash lists files by type only). */
export function kindOfType(contentType: string | null): Kind {
  if (!contentType) return 'other'
  if (contentType === 'application/pdf') return 'pdf'
  if (contentType.startsWith('image/')) return 'image'
  if (/sheet|excel|csv/.test(contentType)) return 'spreadsheet'
  if (contentType.includes('presentation')) return 'presentation'
  if (/word|opendocument\.text/.test(contentType)) return 'document'
  if (contentType === 'application/zip') return 'archive'
  if (/^text\/|json|xml/.test(contentType)) return 'text'
  return 'other'
}

/** The extension as typed ("PDF", "XLSX"), falling back to the kind's. */
export function extensionOf(name: string, kind: Kind) {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toUpperCase() : ''
  return ext && ext.length <= 5 ? ext : KIND_STYLE[kind].ext
}

export function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const { icon, tint } = KIND_STYLE[kind]
  return <IconTile icon={icon} size="sm" className={cn(tint, className)} />
}

/** A small dog-eared sheet on the kind's tile, its icon over the extension (the list's file mark). */
export function FileTile({ file }: { file: { name: string; kind: Kind } }) {
  const { icon: Icon, tint } = KIND_STYLE[file.kind]
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex h-10 w-8 shrink-0 flex-col items-center justify-end gap-0.5 rounded-[5px] pb-1 [clip-path:polygon(0_0,68%_0,100%_24%,100%_100%,0_100%)] after:absolute after:top-0 after:right-0 after:aspect-square after:w-[32%] after:rounded-bl-[3px] after:bg-current/25',
        tint,
      )}
    >
      <Icon className="size-3.5 stroke-[1.75]" />
      <span className="text-[8.5px] leading-none font-semibold tracking-[0.04em]">
        {extensionOf(file.name, file.kind)}
      </span>
    </span>
  )
}

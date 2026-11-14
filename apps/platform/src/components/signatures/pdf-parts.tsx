'use client'

import { Button } from '@helvetly/ui/components/button'
import { formatDate } from '@helvetly/ui/lib/format'
import { useQueryClient } from '@tanstack/react-query'
import { Check, FileText, Loader2, Search, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { PdfView } from '@/components/invoices/pdf-view'
import { errorMessage } from '@/lib/api'
import {
  contentUrl,
  formatSize,
  refreshDocuments,
  uploadDocument,
  useDocList,
  type DocFile,
} from '@/lib/documents'
import { signerColor, type DraftField } from '@/lib/signatures'

import { KindIcon } from '../documents/kind'
import { FieldBox } from './parts'

/** Search the workspace's PDFs, or upload one, and pick it. */
export function PdfPicker({
  document,
  folderId,
  onChoose,
}: {
  document: { id: string; name: string } | null
  /** Where an upload goes. */
  folderId: string | null
  onChoose: (file: DocFile) => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [upload, setUpload] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const query = new URLSearchParams({ kind: 'pdf', sort: '-updated_at', page_size: '40' })
  if (search.trim()) query.set('search', search.trim())
  const list = useDocList(query)
  const files = list.data?.data ?? []

  const uploadPdf = async (file: File) => {
    setUpload(0)
    try {
      const uploaded = await uploadDocument(file, { folderId, onConflict: 'keep_both' }, setUpload)
      refreshDocuments(queryClient)
      onChoose(uploaded)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setUpload(null)
    }
  }

  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-muted-foreground focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30">
          <Search className="size-4 shrink-0 stroke-[1.5]" />
          <input
            type="search"
            aria-label="Search PDFs"
            placeholder="Search PDFs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-placeholder"
          />
        </label>
        <input
          ref={input}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void uploadPdf(file)
            event.target.value = ''
          }}
        />
        <Button
          variant="outline"
          size="lg"
          className="cursor-pointer gap-1.5"
          disabled={upload !== null}
          onClick={() => input.current?.click()}
        >
          {upload !== null ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {Math.round(upload * 100)}%
            </>
          ) : (
            <>
              <Upload className="size-4" /> Upload PDF
            </>
          )}
        </Button>
      </div>
      <div
        aria-label="PDFs"
        className="grid max-h-[min(46vh,440px)] overflow-y-auto rounded-xl border p-1"
      >
        {document && !files.some((file) => file.id === document.id) && (
          <PickedRow name={document.name} />
        )}
        {files.map((file) => (
          <DocRow
            key={file.id}
            file={file}
            selected={file.id === document?.id}
            onPick={() => onChoose(file)}
          />
        ))}
        {files.length === 0 && !document && (
          <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            {list.isPending ? 'Loading…' : search ? 'No PDF matches.' : 'No PDFs yet. Upload one.'}
          </p>
        )}
      </div>
    </section>
  )
}

const rowClass =
  'flex h-12 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-left transition-colors hover:bg-foreground/[0.04] aria-pressed:bg-brand-solid/[0.08]'

function DocRow({
  file,
  selected,
  onPick,
}: {
  file: DocFile
  selected: boolean
  onPick: () => void
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onPick} className={rowClass}>
      <KindIcon kind={file.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">{file.name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {file.folder?.name ?? 'All documents'} · {formatSize(file.size)} ·{' '}
          {formatDate(file.updated_at)}
        </span>
      </span>
      {selected && <Check className="size-4 text-brand" />}
    </button>
  )
}

/** The chosen PDF when the list (a search, the first 40) doesn't show it. */
function PickedRow({ name }: { name: string }) {
  return (
    <button type="button" aria-pressed className={rowClass}>
      <KindIcon kind="pdf" />
      <span className="min-w-0 flex-1 truncate text-[14px]">{name}</span>
      <Check className="size-4 text-brand" />
    </button>
  )
}

/** The chosen PDF, pages fit to the pane, with the fields placed so far. */
export function DocPreview<K extends string>({
  document,
  fields,
  caption,
  pages,
  onPages,
  empty = 'Choose a PDF to see it here.',
}: {
  document: { id: string; name: string } | null
  fields: DraftField<K>[]
  /** What a field's box says: its kind, or (when filling a template) its value. */
  caption: (field: DraftField<K>) => ReactNode
  pages: number
  onPages: (count: number) => void
  empty?: string
}) {
  if (!document)
    return (
      <div className="absolute inset-0 flex items-center justify-center p-8">
        <div className="grid justify-items-center gap-3 text-center">
          <div className="flex aspect-[1/1.414] w-40 items-center justify-center rounded-[3px] bg-white shadow-elevation-1 dark:bg-white/[0.06]">
            <FileText className="size-7 stroke-[1.25] text-muted-foreground/60" />
          </div>
          <p className="text-[13px] text-muted-foreground">{empty}</p>
        </div>
      </div>
    )
  return (
    <>
      <PdfView
        key={document.id}
        src={contentUrl(document.id)}
        title={document.name}
        className="absolute inset-0"
        onPages={onPages}
        overlay={(page) =>
          fields
            .filter((field) => field.page === page)
            .map((field) => (
              <FieldBox
                key={field.key}
                box={field}
                kind={field.kind}
                color={signerColor(field.signer)}
                className="@container gap-1 px-1.5"
              >
                <span className="truncate font-medium">{caption(field)}</span>
              </FieldBox>
            ))
        }
      />
      <span className="pointer-events-none absolute top-3 left-4 z-10 rounded-full bg-card/90 px-2.5 py-1 text-[12px] text-muted-foreground shadow-elevation-1 backdrop-blur">
        Preview{pages > 0 && ` · ${pages} ${pages === 1 ? 'page' : 'pages'}`}
      </span>
    </>
  )
}

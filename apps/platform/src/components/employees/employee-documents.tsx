'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate, formatFileSize } from '@helvetly/ui/lib/format'
import { Download, Lock, LockOpen, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { inputClass, NativeSelect } from '@/components/clients/fields'
import { loadProblemText } from '@/components/data/load-problem'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { errorMessage } from '@/lib/api'
import {
  DOCUMENT_TYPES,
  documentDownloadUrl,
  documentTypeLabel,
  useDeleteDocument,
  useDocumentHold,
  useEmployeeDocuments,
  useUploadDocument,
  type Employee,
  type EmployeeDocument,
} from '@/lib/employees'
import { useCan } from '@/lib/permissions'

const icon = (label: string, onClick: () => void, children: ReactNode, destructive = false) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={onClick}
        className={destructive ? 'text-destructive' : undefined}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
)

/** Private HR files: kept apart from Documents, each with how long it must be kept. */
export function EmployeeDocuments({ employee, owner }: { employee: Employee; owner: boolean }) {
  const query = useEmployeeDocuments(employee.id, true)
  const canWrite = useCan('write:employee-documents') && !employee.restricted && !employee.erased_at
  const hold = useDocumentHold(employee.id)
  const remove = useDeleteDocument(employee.id)
  const [deleting, setDeleting] = useState<EmployeeDocument | null>(null)

  return (
    <>
      {canWrite && <UploadForm id={employee.id} />}
      <Panel title="Documents">
        {query.error ? (
          <p className="text-body-sm text-muted-foreground">
            {loadProblemText(query.error, 'The documents')}
          </p>
        ) : !query.data ? (
          <Loader className="h-16" />
        ) : query.data.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No documents yet.</p>
        ) : (
          <ul className="grid">
            {query.data.map((doc) => (
              <li
                key={doc.id}
                className="grid gap-1.5 border-t border-border/60 py-3 first:border-t-0"
              >
                <div className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <a
                      href={documentDownloadUrl(employee.id, doc.id)}
                      className="truncate text-body underline underline-offset-2"
                    >
                      {doc.name}
                    </a>
                    <span className="text-body-sm text-muted-foreground">
                      {documentTypeLabel(doc.type)}
                      {doc.document_date && ` · dated ${formatDate(doc.document_date)}`} ·{' '}
                      {formatFileSize(doc.size)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {icon(
                      `Download ${doc.name}`,
                      () => window.location.assign(documentDownloadUrl(employee.id, doc.id)),
                      <Download />,
                    )}
                    {owner &&
                      icon(
                        doc.legal_hold ? 'Lift legal hold' : 'Set legal hold',
                        () =>
                          hold.mutate(
                            { doc: doc.id, hold: !doc.legal_hold },
                            { onError: (error) => toast.error(errorMessage(error)) },
                          ),
                        doc.legal_hold ? <LockOpen /> : <Lock />,
                      )}
                    {canWrite &&
                      icon(`Delete ${doc.name}`, () => setDeleting(doc), <Trash2 />, true)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-body-sm">
                  {doc.legal_hold && <StatusBadge tone="amber">Legal hold</StatusBadge>}
                  {doc.retention_due && <StatusBadge tone="red">Review for deletion</StatusBadge>}
                  <span className="text-muted-foreground">{retentionText(doc)}</span>
                </div>
                {doc.retention_guidance && doc.retention_guidance.length > 0 && (
                  <ul
                    aria-label="Retention guidance"
                    className="grid gap-1 rounded-md bg-muted/50 px-3 py-2 text-caption"
                  >
                    {doc.retention_guidance.map((rule) => (
                      <li key={rule.id}>
                        {rule.summary ?? rule.guidance}
                        {rule.guidance && rule.summary && (
                          <span className="text-muted-foreground"> {rule.guidance}</span>
                        )}{' '}
                        <a
                          href={rule.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground underline underline-offset-2"
                        >
                          {rule.source ?? 'Source'}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="px-1 text-caption text-muted-foreground">
        Retention dates are guidance from the rules of the place of work. Check them for your case.
      </p>
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="A document can be deleted within a day of uploading it, or once its retention date has passed. Deleting can’t be undone."
          confirmLabel="Delete document"
          tone="destructive"
          onDecide={(approved) => {
            const doc = deleting
            setDeleting(null)
            if (approved)
              remove.mutate(doc.id, {
                onSuccess: () => toast.success('Document deleted.'),
                onError: (error) => toast.error(errorMessage(error)),
              })
          }}
        />
      )}
    </>
  )
}

/** "Keep until 31 Dec 2036 · set by rule", or why there is no date yet. */
export function retentionText(doc: EmployeeDocument): string {
  if (!doc.retain_until) return 'No retention date yet'
  const until = `Keep until ${formatDate(doc.retain_until)}`
  return doc.retention_rule ? `${until} · set by its retention rule` : `${until} · set by hand`
}

function UploadForm({ id }: { id: string }) {
  const upload = useUploadDocument(id)
  const file = useRef<HTMLInputElement>(null)
  const [type, setType] = useState('')
  const [date, setDate] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  return (
    <Panel title="Add a document">
      <form
        noValidate
        aria-label="Add a document"
        onSubmit={(event) => {
          event.preventDefault()
          const chosen = file.current?.files?.[0]
          const found: FieldErrors = {}
          if (!chosen) found.file = 'Choose a file.'
          if (!type) found.type = 'Choose the kind of document.'
          setErrors(found)
          if (!chosen || !type) return
          const form = new FormData()
          form.append('file', chosen)
          form.append('type', type)
          if (date) form.append('document_date', date)
          upload.mutate(form, {
            onSuccess: () => {
              toast.success(`${chosen.name} added.`)
              if (file.current) file.current.value = ''
              setDate('')
            },
            onError: (error) => {
              const fields = apiFieldErrors(error)
              if (fields && Object.keys(fields).length > 0) setErrors(fields)
              else toast.error(errorMessage(error))
            },
          })
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <FormField
          id="employee-doc-file"
          label="File"
          error={errors.file}
          required
          className="sm:col-span-2"
        >
          <input
            id="employee-doc-file"
            ref={file}
            type="file"
            aria-invalid={errors.file ? true : undefined}
            className={`${inputClass} py-1.5 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium`}
          />
        </FormField>
        <FormField id="employee-doc-type" label="Type" error={errors.type} required>
          <NativeSelect
            id="employee-doc-type"
            value={type}
            aria-invalid={errors.type ? true : undefined}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">Choose a type</option>
            {DOCUMENT_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          id="employee-doc-date"
          label="Document date"
          error={errors.document_date}
          tip="The date on the document; retention periods often count from it."
        >
          <input
            id="employee-doc-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={inputClass}
          />
        </FormField>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" size="sm" className="gap-1.5" disabled={upload.isPending}>
            <Upload className="size-3.5" /> {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

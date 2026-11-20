'use client'

import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
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
import { translate } from '@/lib/i18n'

import { DisabledTip, useHrAccess } from './hr-access'

const icon = (
  label: string,
  onClick: () => void,
  children: ReactNode,
  {
    destructive = false,
    disabledReason = null,
  }: { destructive?: boolean; disabledReason?: string | null } = {},
) =>
  disabledReason ? (
    <DisabledTip reason={`${label}: ${disabledReason}`}>
      <Button variant="ghost" size="icon-sm" aria-label={label} disabled>
        {children}
      </Button>
    </DisabledTip>
  ) : (
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
export function EmployeeDocuments({ employee }: { employee: Employee }) {
  const query = useEmployeeDocuments(employee.id, true)
  const hr = useHrAccess()
  const canWrite = hr.seesEmployeeWrites && !employee.restricted && !employee.erased_at
  const hold = useDocumentHold(employee.id)
  const remove = useDeleteDocument(employee.id)
  const [deleting, setDeleting] = useState<EmployeeDocument | null>(null)

  return (
    <>
      {canWrite && <UploadForm id={employee.id} lockReason={hr.lockReason} />}
      <Panel title={translate('employeeTabDocuments')}>
        {query.error ? (
          <p className="text-body-sm text-muted-foreground">
            {loadProblemText(query.error, translate('employeeTheDocuments'))}
          </p>
        ) : !query.data ? (
          <Loader className="h-16" />
        ) : query.data.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{translate('employeeNoDocuments')}</p>
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
                      {doc.document_date &&
                        ` · ${translate('employeeDocDated', { date: formatDate(doc.document_date) })}`}{' '}
                      · {formatFileSize(doc.size)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {icon(
                      translate('employeeDocDownload', { name: doc.name }),
                      () => window.location.assign(documentDownloadUrl(employee.id, doc.id)),
                      <Download />,
                    )}
                    {hr.owner &&
                      icon(
                        translate(doc.legal_hold ? 'employeeLiftHold' : 'employeeSetHold'),
                        () =>
                          hold.mutate(
                            { doc: doc.id, hold: !doc.legal_hold },
                            { onError: (error) => toast.error(errorMessage(error)) },
                          ),
                        doc.legal_hold ? <LockOpen /> : <Lock />,
                        { disabledReason: hr.lockReason },
                      )}
                    {canWrite &&
                      icon(
                        translate('employeeDocDelete', { name: doc.name }),
                        () => setDeleting(doc),
                        <Trash2 />,
                        { destructive: true, disabledReason: hr.lockReason },
                      )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-body-sm">
                  {doc.legal_hold && <Badge tone="amber">{translate('employeeLegalHold')}</Badge>}
                  {doc.retention_due && <Badge tone="red">{translate('employeeDocReview')}</Badge>}
                  <span className="text-muted-foreground">{retentionText(doc)}</span>
                </div>
                {doc.retention_guidance && doc.retention_guidance.length > 0 && (
                  <ul
                    aria-label={translate('employeeRetentionGuidance')}
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
                          {rule.source ?? translate('employeeSource')}
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
        {translate('employeeRetentionNote')}
      </p>
      {deleting && (
        <ConfirmDialog
          title={translate('employeeDocDeleteTitle', { name: deleting.name })}
          body={translate('employeeDocDeleteBody')}
          confirmLabel={translate('employeeDocDeleteConfirm')}
          tone="destructive"
          onDecide={(approved) => {
            const doc = deleting
            setDeleting(null)
            if (approved)
              remove.mutate(doc.id, {
                onSuccess: () => toast.success(translate('employeeDocDeleted')),
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
  if (!doc.retain_until) return translate('employeeNoRetentionDate')
  return translate(doc.retention_rule ? 'employeeKeepUntilRule' : 'employeeKeepUntilHand', {
    date: formatDate(doc.retain_until),
  })
}

function UploadForm({ id, lockReason }: { id: string; lockReason: string | null }) {
  const upload = useUploadDocument(id)
  const file = useRef<HTMLInputElement>(null)
  const [type, setType] = useState('')
  const [date, setDate] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  return (
    <Panel title={translate('employeeDocAdd')}>
      <form
        noValidate
        aria-label={translate('employeeDocAdd')}
        onSubmit={(event) => {
          event.preventDefault()
          const chosen = file.current?.files?.[0]
          const found: FieldErrors = {}
          if (!chosen) found.file = translate('employeeDocChooseFile')
          if (!type) found.type = translate('employeeDocChooseKind')
          setErrors(found)
          if (!chosen || !type) return
          const form = new FormData()
          form.append('file', chosen)
          form.append('type', type)
          if (date) form.append('document_date', date)
          upload.mutate(form, {
            onSuccess: () => {
              toast.success(translate('employeeAddedToast', { name: chosen.name }))
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
          label={translate('employeeDocFile')}
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
        <FormField
          id="employee-doc-type"
          label={translate('employeeDocType')}
          error={errors.type}
          required
        >
          <NativeSelect
            id="employee-doc-type"
            value={type}
            aria-invalid={errors.type ? true : undefined}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">{translate('employeeDocChooseType')}</option>
            {DOCUMENT_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          id="employee-doc-date"
          label={translate('employeeDocDate')}
          error={errors.document_date}
          tip={translate('employeeDocDateTip')}
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
          <DisabledTip reason={lockReason}>
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={upload.isPending || Boolean(lockReason)}
            >
              <Upload className="size-3.5" />{' '}
              {upload.isPending
                ? translate('employeeDocUploading')
                : translate('employeeDocUpload')}
            </Button>
          </DisabledTip>
        </div>
      </form>
    </Panel>
  )
}

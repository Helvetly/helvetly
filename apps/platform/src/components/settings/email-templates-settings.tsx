'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { FormField, HelpTip, describedBy } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Mail, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { LoadProblem } from '@/components/data/load-problem'
import { ApiError, errorMessage } from '@/lib/api'
import {
  EMAIL_KINDS,
  EMAIL_LANGUAGES,
  useEmailTemplates,
  useResetEmailTemplate,
  useSaveEmailTemplate,
  type EmailKind,
  type EmailLanguage,
  type EmailTemplate,
} from '@/lib/email-templates'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'

import { SettingsSection } from './layout'

const KIND_LABELS: Record<EmailKind, string> = {
  invoice: translate('emailTemplatesKindInvoice'),
  credit_note: translate('emailTemplatesKindCreditNote'),
  proforma: translate('emailTemplatesKindProforma'),
  quote: translate('emailTemplatesKindQuote'),
}

const LANGUAGE_NAMES: Record<EmailLanguage, string> = {
  de: translate('deutsch'),
  fr: translate('franAis'),
  it: translate('italiano'),
  en: translate('english'),
}

const VARIABLE_HINTS: Record<string, string> = {
  document: translate('emailTemplatesVarDocument'),
  number: translate('emailTemplatesVarNumber'),
  client: translate('emailTemplatesVarClient'),
  amount: translate('emailTemplatesVarAmount'),
  company: translate('emailTemplatesVarCompany'),
  due_date: translate('emailTemplatesVarDueDate'),
  valid_until: translate('emailTemplatesVarValidUntil'),
}

type Fields = { subject?: string; body?: string }

/** The API refuses a template with its field names ("subject", "body") under details.fields. */
function templateFieldErrors(error: unknown): Fields | null {
  if (!(error instanceof ApiError) || (error.status !== 400 && error.status !== 422)) return null
  const { fields } = error.details
  if (typeof fields !== 'object' || fields === null) return null
  const found: Fields = {}
  for (const [name, message] of Object.entries(fields))
    if ((name === 'subject' || name === 'body') && typeof message === 'string')
      found[name] = message
  return found
}

/** The emails to clients as a list, one row per document type with a button per language; a button opens that
 * template in a dialog. Each language shows the standard wording until it is customised. */
export function EmailTemplatesSections() {
  const templates = useEmailTemplates()
  const writable = useCan('write:invoice-settings')
  const [open, setOpen] = useState<EmailTemplate | null>(null)
  const data = templates.data
  return (
    <SettingsSection
      id="email-templates"
      icon={Mail}
      title={translate('emailTemplatesTitle')}
      description={
        writable ? translate('emailTemplatesDescription') : translate('emailTemplatesReadOnly')
      }
    >
      {templates.error ? (
        <LoadProblem
          error={templates.error}
          what={translate('emailTemplatesWhat')}
          onRetry={() => void templates.refetch()}
        />
      ) : !data ? (
        <Loader className="min-h-36" />
      ) : (
        <ul className="grid gap-1" aria-label={translate('emailTemplatesTitle')}>
          {EMAIL_KINDS.map((kind) => {
            const ofKind = EMAIL_LANGUAGES.flatMap((language) =>
              data.filter((entry) => entry.kind === kind && entry.language === language),
            )
            const first = ofKind[0]
            if (!first) return null
            const custom = ofKind.filter((entry) => entry.custom).length
            return (
              <li
                key={kind}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
              >
                <button
                  type="button"
                  className="grid min-w-0 flex-1 gap-0.5 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => setOpen(first)}
                >
                  <span className="text-body font-medium">{KIND_LABELS[kind]}</span>
                  <span className="truncate text-body-sm text-muted-foreground">
                    {first.subject}
                  </span>
                  {custom > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {translate('emailTemplatesCustomCount', { count: custom })}
                    </span>
                  )}
                </button>
                <div className="flex gap-1">
                  {ofKind.map((template) => (
                    <Tooltip key={template.language}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="relative w-10 font-mono uppercase"
                          aria-label={translate('emailTemplatesEditIn', {
                            kind: KIND_LABELS[kind],
                            language: LANGUAGE_NAMES[template.language],
                          })}
                          onClick={() => setOpen(template)}
                        >
                          {template.language}
                          {template.custom && (
                            <span
                              aria-hidden
                              className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
                            />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {LANGUAGE_NAMES[template.language]}
                        {template.custom ? ` · ${translate('emailTemplatesCustom')}` : ''}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {open && (
        <TemplateDialog
          key={`${open.kind}-${open.language}`}
          template={open}
          writable={writable}
          onClose={() => setOpen(null)}
        />
      )}
    </SettingsSection>
  )
}

function TemplateDialog({
  template,
  writable,
  onClose,
}: {
  template: EmailTemplate
  writable: boolean
  onClose: () => void
}) {
  const save = useSaveEmailTemplate()
  const reset = useResetEmailTemplate()
  const [values, setValues] = useState({ subject: template.subject, body: template.body })
  const [errors, setErrors] = useState<Fields>({})
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const lastField = useRef<'subject' | 'body'>('body')
  const caret = useRef<number | null>(null)
  const prefix = `email-template-${template.kind}-${template.language}`
  const busy = save.isPending || reset.isPending

  // The new text is in the field only after the render; the cursor goes after it then.
  useEffect(() => {
    if (caret.current === null) return
    const element = lastField.current === 'subject' ? subjectRef.current : bodyRef.current
    element?.focus()
    element?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })

  const set = (field: 'subject' | 'body', text: string) => {
    setValues((current) => ({ ...current, [field]: text }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const insert = (variable: string) => {
    const field = lastField.current
    const element = field === 'subject' ? subjectRef.current : bodyRef.current
    const text = values[field]
    const start = element?.selectionStart ?? text.length
    const end = element?.selectionEnd ?? start
    const token = `{${variable}}`
    caret.current = start + token.length
    set(field, text.slice(0, start) + token + text.slice(end))
  }

  const submit = async () => {
    const missing: Fields = {}
    if (!values.subject.trim()) missing.subject = translate('emailTemplatesEnterSubject')
    if (!values.body.trim()) missing.body = translate('emailTemplatesEnterMessage')
    if (missing.subject || missing.body) {
      setErrors(missing)
      ;(missing.subject ? subjectRef : bodyRef).current?.focus()
      return
    }
    try {
      await save.mutateAsync({
        kind: template.kind,
        language: template.language,
        subject: values.subject.trim(),
        body: values.body,
      })
      toast.success(translate('emailTemplatesSaved'))
      onClose()
    } catch (error) {
      const fields = templateFieldErrors(error)
      if (fields) setErrors(fields)
      else toast.error(errorMessage(error))
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
        // The subject, not the help icon before it: focus on the icon would open its tooltip.
        onOpenAutoFocus={(event) => {
          if (!writable) return
          event.preventDefault()
          subjectRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('emailTemplatesDialogTitle', {
              kind: KIND_LABELS[template.kind],
              language: LANGUAGE_NAMES[template.language],
            })}
          </DialogTitle>
          <DialogDescription className="inline-flex items-center gap-1.5">
            {writable
              ? translate('emailTemplatesTextDescription')
              : translate('emailTemplatesReadOnly')}
            <HelpTip label={translate('emailTemplatesHelpLabel')}>
              {translate('emailTemplatesHelp', { example: '{client}' })}
            </HelpTip>
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <FormField
            id={`${prefix}-subject`}
            label={translate('emailTemplatesSubject')}
            required
            error={errors.subject}
          >
            <Input
              {...describedBy(`${prefix}-subject`, errors.subject)}
              ref={subjectRef}
              required
              disabled={!writable}
              value={values.subject}
              onFocus={() => (lastField.current = 'subject')}
              onChange={(event) => set('subject', event.target.value)}
            />
          </FormField>
          <FormField
            id={`${prefix}-body`}
            label={translate('emailTemplatesMessage')}
            required
            error={errors.body}
          >
            <Textarea
              {...describedBy(`${prefix}-body`, errors.body)}
              ref={bodyRef}
              required
              className="min-h-48"
              disabled={!writable}
              value={values.body}
              onFocus={() => (lastField.current = 'body')}
              onChange={(event) => set('body', event.target.value)}
            />
          </FormField>
          {writable && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-body-sm text-muted-foreground">
                {translate('emailTemplatesVariables')}
              </span>
              {template.variables.map((variable) => (
                <Tooltip key={variable}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="font-mono"
                      onClick={() => insert(variable)}
                    >
                      {`{${variable}}`}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {VARIABLE_HINTS[variable] ?? translate('emailTemplatesVariableUnknown')}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
          <DialogFooter className={cn('items-center', template.custom && 'sm:justify-between')}>
            {writable && template.custom && (
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto"
                disabled={busy}
                onClick={() =>
                  reset
                    .mutateAsync({ kind: template.kind, language: template.language })
                    .then(() => {
                      toast.success(translate('emailTemplatesResetDone'))
                      onClose()
                    })
                    .catch((error: unknown) => void toast.error(errorMessage(error)))
                }
              >
                <RotateCcw aria-hidden />
                {translate('emailTemplatesReset')}
              </Button>
            )}
            <div className="flex gap-2 max-sm:grid max-sm:grid-cols-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {writable ? translate('cancel') : translate('close')}
              </Button>
              {writable && (
                <Button type="submit" disabled={busy}>
                  {save.isPending ? translate('saving') : translate('save')}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

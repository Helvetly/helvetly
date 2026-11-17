'use client'
import { Button } from '@helvetly/ui/components/button'
import { FormField, HelpTip, describedBy } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Mail, PenLine, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { LoadProblem } from '@/components/data/load-problem'
import { useSectionForm, type FieldErrors } from '@/components/section-form'
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

import { SettingsPage, SettingsSection } from './layout'
import { SettingsHeader } from './settings-tabs'

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

/** The API refuses a template with its field names ("subject", "body") under details.fields. */
function templateFieldErrors(error: unknown): FieldErrors | null {
  if (!(error instanceof ApiError) || (error.status !== 400 && error.status !== 422)) return null
  const { fields } = error.details
  if (typeof fields !== 'object' || fields === null) return null
  return Object.fromEntries(
    Object.entries(fields).flatMap(([name, message]) =>
      typeof message === 'string' ? [[name, message]] : [],
    ),
  )
}

export function EmailTemplatesSettingsPage() {
  const templates = useEmailTemplates()
  const writable = useCan('write:invoice-settings')
  const [kind, setKind] = useState<EmailKind>('invoice')
  const [language, setLanguage] = useState<EmailLanguage>('de')
  const data = templates.data
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title={translate('emailTemplatesTitle')}
        description={translate('emailTemplatesDescription')}
      >
        {templates.error ? (
          <LoadProblem
            error={templates.error}
            what={translate('emailTemplatesWhat')}
            onRetry={() => void templates.refetch()}
          />
        ) : data ? (
          <>
            <SettingsSection
              id="email-template-pick"
              icon={Mail}
              title={translate('emailTemplatesPickTitle')}
              description={translate('emailTemplatesPickDescription')}
            >
              <div className="grid gap-4">
                <Segmented
                  label={translate('emailTemplatesKind')}
                  value={kind}
                  options={EMAIL_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
                  onChange={setKind}
                />
                <Tabs
                  value={language}
                  onValueChange={(next) => {
                    const code = EMAIL_LANGUAGES.find((entry) => entry === next)
                    if (code) setLanguage(code)
                  }}
                >
                  <TabsList aria-label={translate('emailTemplatesLanguage')}>
                    {EMAIL_LANGUAGES.map((code) => {
                      const custom = data.find(
                        (entry) => entry.kind === kind && entry.language === code,
                      )?.custom
                      return (
                        <TabsTrigger
                          key={code}
                          value={code}
                          // The dot says "customised" to the eye; the name says it to everyone else.
                          aria-label={
                            custom
                              ? `${code.toUpperCase()}, ${LANGUAGE_NAMES[code]}, ${translate('emailTemplatesCustom').toLowerCase()}`
                              : `${code.toUpperCase()}, ${LANGUAGE_NAMES[code]}`
                          }
                        >
                          {code.toUpperCase()}
                          {custom && (
                            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                          )}
                        </TabsTrigger>
                      )
                    })}
                  </TabsList>
                  {/* The text itself is below, in its own section; these only give each tab its panel. */}
                  {EMAIL_LANGUAGES.map((code) => (
                    <TabsContent key={code} value={code} className="hidden" />
                  ))}
                </Tabs>
              </div>
            </SettingsSection>
            {/* Every template keeps its own unsaved edits while another is shown. */}
            {data.map((template) => (
              <TemplateEditor
                key={`${template.kind}-${template.language}`}
                template={template}
                shown={template.kind === kind && template.language === language}
                writable={writable}
              />
            ))}
          </>
        ) : (
          <Loader className="min-h-36" />
        )}
      </SettingsPage>
    </>
  )
}

function TemplateEditor({
  template,
  shown,
  writable,
}: {
  template: EmailTemplate
  shown: boolean
  writable: boolean
}) {
  const reset = useResetEmailTemplate()
  return (
    <EditorForm
      // A reset loads the standard wording again: the form starts over from the refreshed template.
      key={String(template.custom)}
      template={template}
      shown={shown}
      writable={writable}
      resetting={reset.isPending}
      onReset={() =>
        reset
          .mutateAsync({ kind: template.kind, language: template.language })
          .then(() => void toast.success(translate('emailTemplatesResetDone')))
          .catch((error: unknown) => void toast.error(errorMessage(error)))
      }
    />
  )
}

function EditorForm({
  template,
  shown,
  writable,
  resetting,
  onReset,
}: {
  template: EmailTemplate
  shown: boolean
  writable: boolean
  resetting: boolean
  onReset: () => void
}) {
  const save = useSaveEmailTemplate()
  const form = useSectionForm({
    initial: { subject: template.subject, body: template.body },
    sections: [{ id: 'text', fields: ['subject', 'body'] }],
    save: (values) =>
      save.mutateAsync({
        kind: template.kind,
        language: template.language,
        subject: values.subject.trim(),
        body: values.body,
      }),
    fieldErrors: templateFieldErrors,
    savedMessage: () => translate('emailTemplatesSaved'),
  })
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const lastField = useRef<'subject' | 'body'>('body')
  const caret = useRef<number | null>(null)
  const prefix = `email-template-${template.kind}-${template.language}`

  // The new text is in the field only after the render; the cursor goes after it then.
  useEffect(() => {
    if (caret.current === null) return
    const element = lastField.current === 'subject' ? subjectRef.current : bodyRef.current
    element?.focus()
    element?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })

  const insert = (variable: string) => {
    const field = lastField.current
    const element = field === 'subject' ? subjectRef.current : bodyRef.current
    const text = form.values[field]
    const start = element?.selectionStart ?? text.length
    const end = element?.selectionEnd ?? start
    const token = `{${variable}}`
    caret.current = start + token.length
    form.set(field, text.slice(0, start) + token + text.slice(end))
  }

  const section = form.section('text')
  return (
    <div hidden={!shown}>
      <SettingsSection
        id={prefix}
        icon={PenLine}
        title={
          <span className="inline-flex items-center gap-1.5">
            {translate('emailTemplatesTextTitle')}
            <HelpTip label={translate('emailTemplatesHelpLabel')}>
              {translate('emailTemplatesHelp', { example: '{client}' })}
            </HelpTip>
          </span>
        }
        description={
          writable
            ? translate('emailTemplatesTextDescription')
            : translate('emailTemplatesReadOnly')
        }
        section={writable ? section : undefined}
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            section.save()
          }}
        >
          <FormField
            id={`${prefix}-subject`}
            label={translate('emailTemplatesSubject')}
            error={form.errors.subject}
          >
            <Input
              {...describedBy(`${prefix}-subject`, form.errors.subject)}
              ref={subjectRef}
              disabled={!writable}
              value={form.values.subject}
              onFocus={() => (lastField.current = 'subject')}
              onChange={(event) => form.set('subject', event.target.value)}
            />
          </FormField>
          <FormField
            id={`${prefix}-body`}
            label={translate('emailTemplatesMessage')}
            error={form.errors.body}
          >
            <Textarea
              {...describedBy(`${prefix}-body`, form.errors.body)}
              ref={bodyRef}
              className="min-h-40"
              disabled={!writable}
              value={form.values.body}
              onFocus={() => (lastField.current = 'body')}
              onChange={(event) => form.set('body', event.target.value)}
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
          {writable && template.custom && (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={resetting || section.saving}
                onClick={onReset}
              >
                <RotateCcw className="size-3.5" />
                {translate('emailTemplatesReset')}
              </Button>
            </div>
          )}
        </form>
      </SettingsSection>
    </div>
  )
}

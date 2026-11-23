'use client'
import { locale } from '@helvetly/i18n'
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
import { Segmented } from '@helvetly/ui/components/segmented'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Mail, Pencil, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { LoadProblem } from '@/components/data/load-problem'
import { TextareaBox } from '@/components/textarea-box'
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

import { TemplateAIButton, TemplateAIPanel, type TemplateTexts } from './email-template-ai'
import { SettingsSection } from './layout'

/** A template's longest message and subject (emailtemplate.MaxTemplate and maxSubject); the API refuses more. */
export const TEMPLATE_MESSAGE_MAX = 1000
const TEMPLATE_SUBJECT_MAX = 200

const KIND_LABELS: Record<EmailKind, string> = {
  invoice: translate('emailTemplatesKindInvoice'),
  credit_note: translate('emailTemplatesKindCreditNote'),
  proforma: translate('emailTemplatesKindProforma'),
  quote: translate('emailTemplatesKindQuote'),
  document: translate('emailTemplatesKindDocument'),
  signature_request: translate('emailTemplatesKindSignatureRequest'),
  signature_reminder: translate('emailTemplatesKindSignatureReminder'),
}

/** What each email is, under its name in the list. */
const KIND_ABOUT: Record<EmailKind, string> = {
  invoice: translate('emailTemplatesAboutInvoice'),
  credit_note: translate('emailTemplatesAboutCreditNote'),
  proforma: translate('emailTemplatesAboutProforma'),
  quote: translate('emailTemplatesAboutQuote'),
  document: translate('emailTemplatesAboutDocument'),
  signature_request: translate('emailTemplatesAboutSignatureRequest'),
  signature_reminder: translate('emailTemplatesAboutSignatureReminder'),
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
  sender: translate('emailTemplatesVarSender'),
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

/** The interface language when a template exists in it, so the dialog opens on the wording one reads. */
const firstLanguage: EmailLanguage = EMAIL_LANGUAGES.find((code) => code === locale) ?? 'de'

type Draft = { subject: string; body: string }

/** The emails to clients as a list, one row per document type; a row opens its templates in a dialog, where the
 * language is chosen. Each language shows the standard wording until it is customised. */
export function EmailTemplatesSections() {
  const templates = useEmailTemplates()
  const writable = useCan('write:invoice-settings')
  const [open, setOpen] = useState<EmailKind | null>(null)
  const data = templates.data
  const ofKind = (kind: EmailKind) =>
    EMAIL_LANGUAGES.flatMap((language) =>
      (data ?? []).filter((entry) => entry.kind === kind && entry.language === language),
    )
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
            const all = ofKind(kind)
            if (!all.length) return null
            const custom = all.filter((entry) => entry.custom).length
            return (
              <li key={kind}>
                <button
                  type="button"
                  aria-label={translate('emailTemplatesEdit', { kind: KIND_LABELS[kind] })}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => setOpen(kind)}
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-body font-medium">{KIND_LABELS[kind]}</span>
                    <span className="text-body-sm text-pretty text-muted-foreground">
                      {KIND_ABOUT[kind]}
                    </span>
                    {custom > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {translate('emailTemplatesCustomCount', { count: custom })}
                      </span>
                    )}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-body-sm text-muted-foreground">
                    <Pencil aria-hidden className="size-3.5" />
                    {writable ? translate('edit4') : translate('emailTemplatesView')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {open && (
        <TemplateDialog
          key={open}
          kind={open}
          templates={ofKind(open)}
          writable={writable}
          onClose={() => setOpen(null)}
        />
      )}
    </SettingsSection>
  )
}

const unchanged = (draft: Draft, template: EmailTemplate) =>
  draft.subject === template.subject && draft.body === template.body

function TemplateDialog({
  kind,
  templates,
  writable,
  onClose,
}: {
  kind: EmailKind
  templates: EmailTemplate[]
  writable: boolean
  onClose: () => void
}) {
  const save = useSaveEmailTemplate()
  const reset = useResetEmailTemplate()
  const [language, setLanguage] = useState<EmailLanguage>(
    templates.some((entry) => entry.language === firstLanguage)
      ? firstLanguage
      : (templates[0]?.language ?? 'de'),
  )
  // Every language keeps its own unsaved edits while another is shown; Save sends each changed one.
  const [drafts, setDrafts] = useState<Partial<Record<EmailLanguage, Draft>>>({})
  const [errors, setErrors] = useState<Partial<Record<EmailLanguage, Fields>>>({})
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const lastField = useRef<'subject' | 'body'>('body')
  const caret = useRef<number | null>(null)
  const [aiOpen, setAIOpen] = useState(false)
  // The drafts before Heidi's texts were applied: Undo puts them back until Save.
  const [beforeAI, setBeforeAI] = useState<typeof drafts | null>(null)
  const template = templates.find((entry) => entry.language === language)
  const busy = save.isPending || reset.isPending

  // The new text is in the field only after the render; the cursor goes after it then.
  useEffect(() => {
    if (caret.current === null) return
    const element = lastField.current === 'subject' ? subjectRef.current : bodyRef.current
    element?.focus()
    element?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })

  if (!template) return null
  const values = drafts[language] ?? { subject: template.subject, body: template.body }
  const shownErrors = errors[language] ?? {}
  const prefix = `email-template-${kind}-${language}`

  const set = (field: 'subject' | 'body', text: string) => {
    setDrafts((current) => ({ ...current, [language]: { ...values, [field]: text } }))
    setErrors((current) => ({
      ...current,
      [language]: { ...current[language], [field]: undefined },
    }))
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

  const textOf = (code: EmailLanguage): Draft => {
    const saved = templates.find((entry) => entry.language === code)
    return drafts[code] ?? { subject: saved?.subject ?? '', body: saved?.body ?? '' }
  }
  const texts: TemplateTexts = {
    de: textOf('de'),
    fr: textOf('fr'),
    it: textOf('it'),
    en: textOf('en'),
  }

  const applyAI = (written: TemplateTexts) => {
    setBeforeAI(drafts)
    setDrafts(written)
    setErrors({})
    setAIOpen(false)
  }

  const changed = templates.flatMap((entry) => {
    const draft = drafts[entry.language]
    return draft && !unchanged(draft, entry) ? [{ entry, draft }] : []
  })

  const submit = async () => {
    const missing: Partial<Record<EmailLanguage, Fields>> = {}
    for (const { entry, draft } of changed) {
      const found: Fields = {}
      if (!draft.subject.trim()) found.subject = translate('emailTemplatesEnterSubject')
      if (!draft.body.trim()) found.body = translate('emailTemplatesEnterMessage')
      if (found.subject || found.body) missing[entry.language] = found
    }
    const first = EMAIL_LANGUAGES.find((code) => missing[code])
    if (first) {
      setErrors(missing)
      setLanguage(first)
      return
    }
    const results = await Promise.allSettled(
      changed.map(({ entry, draft }) =>
        save.mutateAsync({
          kind,
          language: entry.language,
          subject: draft.subject.trim(),
          body: draft.body,
        }),
      ),
    )
    const failed = changed.flatMap(({ entry }, index) => {
      const result = results[index]
      return result?.status === 'rejected'
        ? [{ language: entry.language, error: result.reason }]
        : []
    })
    // What was saved leaves the drafts; what failed stays, so nothing typed is lost.
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([code]) => failed.some((item) => item.language === code)),
      ),
    )
    const refused = failed[0]
    if (refused) {
      const fields = templateFieldErrors(refused.error)
      if (fields) {
        setErrors({ [refused.language]: fields })
        setLanguage(refused.language)
      } else toast.error(errorMessage(refused.error))
      return
    }
    if (changed.length) toast.success(translate('emailTemplatesSaved'))
    onClose()
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
            {translate('emailTemplatesDialogTitle', { kind: KIND_LABELS[kind] })}
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
          <Segmented
            label={translate('emailTemplatesLanguage')}
            value={language}
            options={templates.map((entry) => {
              const edited = changed.some((item) => item.entry.language === entry.language)
              const marked = entry.custom || edited
              return {
                value: entry.language,
                // The dot says "customised" to the eye; the name says it to everyone else.
                name: marked
                  ? `${LANGUAGE_NAMES[entry.language]}, ${edited ? translate('emailTemplatesUnsaved') : translate('emailTemplatesCustom').toLowerCase()}`
                  : undefined,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    {LANGUAGE_NAMES[entry.language]}
                    {marked && (
                      <span
                        aria-hidden
                        className={cn(
                          'size-1.5 rounded-full',
                          edited ? 'bg-warning' : 'bg-primary',
                        )}
                      />
                    )}
                  </span>
                ),
              }
            })}
            onChange={setLanguage}
          />
          <FormField
            id={`${prefix}-subject`}
            label={translate('emailTemplatesSubject')}
            required
            error={shownErrors.subject}
            mark={
              writable && (
                <span
                  data-slot="textarea-count"
                  className={cn(
                    'ml-auto text-xs text-muted-foreground tabular-nums',
                    values.subject.length > TEMPLATE_SUBJECT_MAX && 'text-destructive',
                  )}
                >
                  {values.subject.length} / {TEMPLATE_SUBJECT_MAX}
                </span>
              )
            }
          >
            <Input
              {...describedBy(`${prefix}-subject`, shownErrors.subject)}
              maxLength={TEMPLATE_SUBJECT_MAX}
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
            error={shownErrors.body}
          >
            <TextareaBox
              {...describedBy(`${prefix}-body`, shownErrors.body)}
              ref={bodyRef}
              required
              resizable={false}
              maxLength={TEMPLATE_MESSAGE_MAX}
              max={writable ? TEMPLATE_MESSAGE_MAX : undefined}
              className="field-sizing-content max-h-[calc(8lh+0.75rem)] min-h-[calc(4lh+0.75rem)] leading-relaxed"
              disabled={!writable}
              value={values.body}
              onFocus={() => (lastField.current = 'body')}
              onChange={(event) => set('body', event.target.value)}
              tools={
                writable && (
                  <TemplateAIButton open={aiOpen} onOpen={() => setAIOpen((open) => !open)} />
                )
              }
            />
          </FormField>
          {writable && aiOpen && (
            <TemplateAIPanel
              kind={kind}
              current={texts}
              onApply={applyAI}
              onClose={() => setAIOpen(false)}
            />
          )}
          {beforeAI && (
            <p className="flex items-center gap-2 text-body-sm text-muted-foreground" role="status">
              {translate('emailTemplatesAIApplied')}
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => {
                  setDrafts(beforeAI)
                  setBeforeAI(null)
                }}
              >
                {translate('undo')}
              </Button>
            </p>
          )}
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
                    .mutateAsync({ kind, language })
                    .then(() => {
                      setDrafts(({ [language]: _reset, ...rest }) => rest)
                      toast.success(translate('emailTemplatesResetDone'))
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

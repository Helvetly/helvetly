// Email templates and the drafts built from them (T3-T5 of the email-templates plan), typed by hand.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { request } from '@/lib/api'

export const EMAIL_KINDS = [
  'invoice',
  'credit_note',
  'proforma',
  'quote',
  'payment_confirmation',
  'document',
  'signature_request',
  'signature_reminder',
] as const
export const EMAIL_LANGUAGES = ['de', 'fr', 'it', 'en'] as const
export type EmailKind = (typeof EMAIL_KINDS)[number]
export type EmailLanguage = (typeof EMAIL_LANGUAGES)[number]

export type EmailTemplate = {
  kind: EmailKind
  language: EmailLanguage
  subject: string
  body: string
  custom: boolean
  default: { subject: string; body: string }
  variables: string[]
}
export type EmailTemplateInput = { kind: EmailKind; language: EmailLanguage }
export type EmailTemplateSave = EmailTemplateInput & { subject: string; body: string }
/** `reply_to`: where the client's answer goes (the reply-to email, else the company's, else the sender's). */
export type EmailDraft = {
  to: string[]
  subject: string
  message: string
  reply_to?: string
  amount_due?: string
}

/** An email as the client would get it, from a send step's preview route. */
export type EmailPreview = { subject: string; html: string }

type One<T> = { data: T }

const templatePath = ({ kind, language }: EmailTemplateInput) =>
  `/email-templates/${kind}/${language}`

export const emailTemplatesApi = {
  list: () => request<One<EmailTemplate[]>>('/email-templates'),
  save: ({ subject, body, ...which }: EmailTemplateSave) =>
    request<One<EmailTemplate>>(templatePath(which), { method: 'PUT', json: { subject, body } }),
  reset: (which: EmailTemplateInput) =>
    request<One<EmailTemplate>>(templatePath(which), { method: 'DELETE' }),
}

export const emailTemplateKeys = {
  all: ['email-templates'] as const,
  invoiceDraft: (id: string) => ['invoices', 'detail', id, 'email-draft'] as const,
  quoteDraft: (id: string) => ['quotes', 'detail', id, 'email-draft'] as const,
}

export function useEmailTemplates() {
  return useQuery({
    queryKey: emailTemplateKeys.all,
    queryFn: async () => (await emailTemplatesApi.list()).data,
  })
}

export function useInvoiceEmailDraft(id: string) {
  return useQuery({
    queryKey: emailTemplateKeys.invoiceDraft(id),
    queryFn: async () =>
      (await request<One<EmailDraft>>(`/invoices/${encodeURIComponent(id)}/email`)).data,
  })
}

export function useQuoteEmailDraft(id: string) {
  return useQuery({
    queryKey: emailTemplateKeys.quoteDraft(id),
    queryFn: async () =>
      (await request<One<EmailDraft>>(`/quotes/${encodeURIComponent(id)}/email`)).data,
  })
}

/** A changed template changes every draft built from it, so templates and all drafts refetch. */
function useInvalidateEmails() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: emailTemplateKeys.all }),
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] !== 'email-templates' && queryKey[3] === 'email-draft',
      }),
    ])
}

export function useSaveEmailTemplate() {
  const invalidate = useInvalidateEmails()
  return useMutation({
    mutationFn: async (input: EmailTemplateSave) => (await emailTemplatesApi.save(input)).data,
    onSuccess: invalidate,
  })
}

export function useResetEmailTemplate() {
  const invalidate = useInvalidateEmails()
  return useMutation({
    mutationFn: async (input: EmailTemplateInput) => (await emailTemplatesApi.reset(input)).data,
    onSuccess: invalidate,
  })
}

/** A language for an email: the client's when it is one of ours, else the given fallback. */
export const emailLanguage = (
  language: string | null | undefined,
  fallback: EmailLanguage = 'en',
): EmailLanguage => EMAIL_LANGUAGES.find((code) => code === language) ?? fallback

/**
 * A kind's subject and message in a language as the workspace has them (its own, else the built-in text), the
 * {names} filled from values (an unknown or empty one stays as it is written, as the API renders it); null until
 * the templates load.
 */
export function fillEmailTemplate(
  templates: EmailTemplate[] | undefined,
  kind: EmailKind,
  language: EmailLanguage,
  values: Record<string, string>,
): { subject: string; body: string } | null {
  const template = templates?.find((entry) => entry.kind === kind && entry.language === language)
  if (!template) return null
  const fill = (text: string) =>
    text.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all)
  return {
    subject: fill(template.subject).replace(/\s+/g, ' ').trim(),
    body: fill(template.body),
  }
}

/** value, once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  const key = JSON.stringify(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(JSON.parse(key) as T), ms)
    return () => clearTimeout(timer)
  }, [key, ms])
  return settled
}

/**
 * The real branded email for what a send step has so far, from its preview route (`/signatures/email-preview`,
 * `/templates/email-preview`): asked again once typing pauses, the last one shown meanwhile.
 */
export function useEmailPreview(path: string, body: Record<string, unknown>, enabled = true) {
  const settled = useSettled(body, 400)
  return useQuery({
    queryKey: ['email-preview', path, settled],
    queryFn: async () =>
      (await request<One<EmailPreview>>(path, { method: 'POST', json: settled })).data,
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * The subject and message a send step shows: the template's, filled from values, until the person types; what
 * they typed is never replaced by it (a changed language or title refills only what is untouched).
 */
export function useTemplateDraft(
  kind: EmailKind,
  language: EmailLanguage,
  values: Record<string, string>,
) {
  const templates = useEmailTemplates()
  const [subject, setSubject] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const filled = fillEmailTemplate(templates.data, kind, language, values)
  return {
    subject: subject ?? filled?.subject ?? '',
    message: message ?? filled?.body ?? '',
    setSubject,
    setMessage,
    touched: subject !== null || message !== null,
    loading: templates.isPending,
  }
}

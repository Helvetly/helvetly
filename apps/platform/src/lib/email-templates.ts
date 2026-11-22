// Email templates and the drafts built from them (T3-T5 of the email-templates plan), typed by hand.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request } from '@/lib/api'

export const EMAIL_KINDS = ['invoice', 'credit_note', 'proforma', 'quote'] as const
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
export type EmailDraft = { to: string[]; subject: string; message: string; reply_to?: string }

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

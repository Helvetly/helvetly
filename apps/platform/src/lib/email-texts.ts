// Helvetly's built-in client email texts and the drafts built from them, typed by hand. Workspaces cannot change the
// texts; a person changes a draft only for the one email they send.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
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

/** A built-in subject and message with {variables}. */
export type EmailText = { kind: EmailKind; language: EmailLanguage; subject: string; body: string }
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

export const emailKeys = {
  texts: ['email-texts'] as const,
  invoiceDraft: (id: string) => ['invoices', 'detail', id, 'email-draft'] as const,
  quoteDraft: (id: string) => ['quotes', 'detail', id, 'email-draft'] as const,
}

export function useEmailTexts() {
  return useQuery({
    queryKey: emailKeys.texts,
    queryFn: async () => (await request<One<EmailText[]>>('/email-texts')).data,
    staleTime: Infinity,
  })
}

export function useInvoiceEmailDraft(id: string) {
  return useQuery({
    queryKey: emailKeys.invoiceDraft(id),
    queryFn: async () =>
      (await request<One<EmailDraft>>(`/invoices/${encodeURIComponent(id)}/email`)).data,
  })
}

export function useQuoteEmailDraft(id: string) {
  return useQuery({
    queryKey: emailKeys.quoteDraft(id),
    queryFn: async () =>
      (await request<One<EmailDraft>>(`/quotes/${encodeURIComponent(id)}/email`)).data,
  })
}

/** A language for an email: the client's when it is one of ours, else the given fallback. */
export const emailLanguage = (
  language: string | null | undefined,
  fallback: EmailLanguage = 'en',
): EmailLanguage => EMAIL_LANGUAGES.find((code) => code === language) ?? fallback

/**
 * A kind's built-in subject and message in a language, the {names} filled from values (an unknown or empty one
 * stays as it is written, as the API renders it); null until the texts load.
 */
export function fillEmailText(
  texts: EmailText[] | undefined,
  kind: EmailKind,
  language: EmailLanguage,
  values: Record<string, string>,
): { subject: string; body: string } | null {
  const text = texts?.find((entry) => entry.kind === kind && entry.language === language)
  if (!text) return null
  const fill = (text: string) =>
    text.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all)
  return {
    subject: fill(text.subject).replace(/\s+/g, ' ').trim(),
    body: fill(text.body),
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
 * The subject and message a send step shows: the built-in text, filled from values, until the person types; what
 * they typed is never replaced by it (a changed language or title refills only what is untouched).
 */
export function useEmailTextDraft(
  kind: EmailKind,
  language: EmailLanguage,
  values: Record<string, string>,
) {
  const texts = useEmailTexts()
  const [subject, setSubject] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const filled = fillEmailText(texts.data, kind, language, values)
  return {
    subject: subject ?? filled?.subject ?? '',
    message: message ?? filled?.body ?? '',
    setSubject,
    setMessage,
    touched: subject !== null || message !== null,
    loading: texts.isPending,
  }
}

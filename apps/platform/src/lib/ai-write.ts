import { ApiError, request } from '@/lib/api'
import { translate } from '@/lib/i18n'

/** The form fields "Write with AI" serves (POST /api/v1/ai/write). */
export type AIWriteField =
  | 'product_description'
  | 'engagement_description'
  | 'invoice_intro'
  | 'invoice_footer'
  | 'quote_intro'

export type AIWriteAction = 'draft' | 'improve' | 'shorten' | 'formal' | 'custom'

export type AIWriteInput = {
  field: AIWriteField
  action: AIWriteAction
  /** The field's current text; may be empty for a draft. */
  text: string
  /** Required for `custom`, at most 300 characters. */
  instruction?: string
  /** Defaults to the workspace's document language, else English. */
  language?: 'de' | 'fr' | 'it' | 'en'
  /** The field's limit, 1..4000 (default 1000); the answer never exceeds it. */
  max_length?: number
  /** Other form values (name, price, unit, client, period…): at most 20 keys, values up to 300 characters. */
  context?: Record<string, string>
}

/** The written text. Refusals throw the API error: ai_consent_required, feature_not_in_plan, quota_exceeded,
 *  ai_busy, ai_failed, ai_unavailable, ai_unreadable, rate_limited, validation_failed. */
export async function aiWrite(input: AIWriteInput): Promise<string> {
  const { data } = await request<{ data: { text: string } }>('/ai/write', {
    method: 'POST',
    json: input,
  })
  return data.text
}

/** What went wrong, in words for the person writing: a missing route or a server error never shows raw. */
export function aiWriteError(error: unknown): { message: string; retry: boolean } {
  if (!(error instanceof ApiError))
    return { message: translate('aiWriteErrorNetwork'), retry: true }
  if (error.status === 404 || error.code === 'ai_unavailable')
    return { message: translate('aiWriteErrorUnavailable'), retry: false }
  if (error.code === 'quota_exceeded') return { message: error.message, retry: false }
  if (error.code === 'ai_busy') return { message: translate('aiErrorBusy'), retry: true }
  if (error.code === 'ai_failed') return { message: translate('aiWriteErrorFailed'), retry: true }
  if (error.status === 429 || error.status >= 500) return { message: error.message, retry: true }
  return { message: error.message, retry: false }
}

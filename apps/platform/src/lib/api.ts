import { localizedHref } from '@helvetly/i18n'
// Typed by hand from docs/auth-contract.md; the request core is @helvetly/ui/lib/http.
import { API_PREFIX, request, type EmailCodeSent, type RequestOptions } from '@helvetly/ui/lib/http'

import type { CreationOptionsJSON, RequestOptionsJSON } from '@/lib/passkeys'

export {
  ApiError,
  changeSession,
  errorFromBody,
  errorMessage,
  getCsrfToken,
  request,
  respond,
  setCsrfToken,
  setUnauthorizedHandler,
  type EmailCodeSent,
} from '@helvetly/ui/lib/http'

export type AuthConfig = {
  google: boolean
  email: boolean
  passkey: boolean
  dev_codes: boolean
  /** The client portal's origin, where clients sign in (missing from an older API). */
  portal_url?: string
  /** GA4 measurement id of the platform's page views (GOOGLE_ANALYTICS_ID); empty or missing = no analytics. */
  google_analytics_id?: string
  /** Where tokens and agents call the API (PUBLIC_API_URL, else the platform's origin; missing from an older API). */
  api_url?: string
  /** The installation has an AI model (OPENAI_API_KEY); false hides every AI option (missing from an older API). */
  ai_available?: boolean
}
export type User = { id: string; email: string; name: string; avatar_url: string | null }
export type Session = {
  user: User
  /**
   * `timezone`: the IANA name dates follow (optional only for older test fixtures). `country`: the business's
   * country from the invoice settings' seller, CH when none is saved (missing from an older API).
   */
  workspace: {
    id: string
    name: string
    timezone?: string
    logo_url?: string | null
    country?: string
  }
  role: string
  /** What the person may use (`read:clients`, `*:*`); missing until the API sends it: everything. */
  scopes?: string[]
  /** Finished or skipped the welcome (components/onboarding); false shows it. */
  onboarded: boolean
  csrf_token: string
  /** Keyed hashes of the user's and workspace's ids for Google Analytics (optional only for older test fixtures). */
  analytics?: { user_id: string; workspace_id: string }
}
export type SignedIn = { csrf_token: string; next: string }
export type TwoFactorRequired = { two_factor_required: true; challenge_id: string }
export type SignInResult = SignedIn | TwoFactorRequired
export type Passkey = { id: string; name: string; created_at: string; last_used_at: string | null }
type Challenge<PublicKeyOptions> = { challenge_id: string; options: PublicKeyOptions }

// Dashboard chart amounts are presentation numbers in the selected original currency;
// financial document amounts remain exact decimal strings in their domain contracts.
export type Expense = {
  id: string
  vendor: string
  category: string
  date: string
  amount: number
  vat: number
  status: 'approved' | 'pending' | 'rejected'
}
export type CashFlowPoint = { date: string; income: number; expenses: number }
export type Dashboard = {
  currency: string
  currencies: string[]
  outstanding: number
  open_count: number
  paid_this_month: number
  /** Change against last month, as a share (0.12 = +12 %). */
  paid_change: number
  overdue_count: number
  invoice_count: number
  avg_days_to_pay: number
  collection_rate: number
  spent_this_month: number
  vat_to_reclaim: number
  pending_count: number
  expense_count: number
  receipts_matched: number
  /** Selected-currency totals, oldest first; outstanding is today's balance by issue month. */
  trends: { outstanding: number[]; paid: number[]; spent: number[]; vat: number[] }
  cash_flow: {
    '30d': CashFlowPoint[]
    '90d': CashFlowPoint[]
    '12m': CashFlowPoint[]
    /** Months from January four years back to this month. */
    years: CashFlowPoint[]
  }
  unread: { notifications: number; inbox: number }
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** A full page load to the API, which sends the browser to Google and back. */
export function googleStartUrl(next: string): string {
  const query = new URLSearchParams({
    next: localizedHref(next),
    login: localizedHref('/login'),
    timezone: browserTimeZone(),
  })
  return `${API_PREFIX}/auth/google/start?${query}`
}

const post = (json: unknown, isPublic = false): RequestOptions => ({
  method: 'POST',
  json,
  public: isPublic,
})

export const api = {
  authConfig: () => request<AuthConfig>('/auth/config', { public: true }),
  startEmailSignIn: (email: string) =>
    request<EmailCodeSent>('/auth/email/start', post({ email }, true)),
  verifyEmailSignIn: (body: { email: string; code: string; next: string; timezone: string }) =>
    request<SignInResult>('/auth/email/verify', post(body, true)),
  startPasskeySignIn: () =>
    request<Challenge<RequestOptionsJSON>>('/auth/passkey/start', post({}, true)),
  finishPasskeySignIn: (body: { challenge_id: string; response: unknown; next: string }) =>
    request<SignInResult>('/auth/passkey/finish', post(body, true)),
  verifyTwoFactor: (body: { challenge_id: string; code: string }) =>
    request<SignedIn>('/auth/two-factor/verify', post(body, true)),

  session: () => request<Session>('/session'),
  signOut: () => request<void>('/session', { method: 'DELETE' }),
  finishOnboarding: () => request<void>('/session/onboarded', { method: 'POST' }),
  passkeys: () => request<{ data: Passkey[] }>('/account/passkeys'),
  startPasskey: () => request<Challenge<CreationOptionsJSON>>('/account/passkeys/start', post({})),
  finishPasskey: (body: { challenge_id: string; name: string; response: unknown }) =>
    request<{ data: Passkey[] }>('/account/passkeys/finish', post(body)),
  deletePasskey: (id: string) =>
    request<void>(`/account/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getKeyFigures: (currency?: string) =>
    request<Dashboard>(
      `/reports/key-figures${currency ? `?currency=${encodeURIComponent(currency)}` : ''}`,
    ),
}

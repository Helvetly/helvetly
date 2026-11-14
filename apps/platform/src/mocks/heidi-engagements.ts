import { formatDate } from '@helvetly/ui/lib/format'
// shortcut: Heidi's engagement intents. The model is scripted, but the data is real: the engagements
// API is live, so these read and write it with msw's `bypass` (the request skips the mock handlers).
import { bypass } from 'msw'

import type { Engagement, Entry, Period } from '@/lib/engagements'
import type { HeidiAction, HeidiConfirmation, HeidiForm } from '@/lib/heidi'

import { done, lines, status, words, type Step } from './heidi-steps'

const amount = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 2 })
const unitOf = (unit: Engagement['unit'], value: number) =>
  unit === 'hour' ? 'h' : unit === 'day' ? (value === 1 ? 'day' : 'days') : (unit ?? '')
const show = (decimal: string, unit: Engagement['unit']) =>
  `${amount.format(Number(decimal))} ${unitOf(unit, Number(decimal))}`.trim()

export type LogRequest = { quantity: string; client: string; note: string | null }

const LOG =
  /^\s*(?:please\s+)?(?:log|book|add|trag(?:e)?|buche?|erfasse?)\s+(\d+(?:[.,]\d+)?)\s*(?:h|hrs?|hours?|stunden?|std\.?|days?|tage?n?|d)?\s+(?:for|to|on|für|fuer|bei)\s+(.+?)(?:\s+ein)?\s*(?::\s*(.+))?$/i

/** "log 2h for Müller: Konjunktiv II", "Trag 1,5 Stunden für Keller AG ein"; null for anything else. */
export function parseLogRequest(text: string): LogRequest | null {
  const match = LOG.exec(text.trim())
  const [, quantity, client, note] = match ?? []
  if (!quantity || !client) return null
  return { quantity: quantity.replace(',', '.'), client: client.trim(), note: note?.trim() || null }
}

const PLURAL: Record<string, string> = {
  hour: 'hours',
  day: 'days',
  piece: 'pieces',
  month: 'months',
  km: 'km',
  flat: 'units',
}

/** The unit a request names ("2h", "1,5 Stunden", "1 Tag"); null when it names none. */
export function requestedUnit(text: string): 'hour' | 'day' | null {
  const word = /\d\s*(h|hrs?|hours?|stunden?|std\.?|days?|tage?n?|d)\s+\S/i
    .exec(text)?.[1]
    ?.toLowerCase()
  if (!word) return null
  return /^(d|days?|tage?n?)$/.test(word) ? 'day' : 'hour'
}

async function call(path: string, init?: RequestInit) {
  return fetch(bypass(new Request(new URL(`/api/v1${path}`, location.origin), init)))
}

async function failure(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  const message =
    typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined
  return typeof message === 'object' && message !== null && 'message' in message
    ? String(message.message)
    : `The request failed (${response.status}).`
}

async function engagements(query: Record<string, string>): Promise<Engagement[]> {
  const response = await call(`/engagements?${new URLSearchParams({ page_size: '50', ...query })}`)
  if (!response.ok) throw new Error(await failure(response))
  const body: { data: Engagement[] } = await response.json()
  return body.data
}

const openActions = (list: Engagement[]): HeidiAction[] =>
  list
    .slice(0, 2)
    .map((e) => ({ id: 'open_engagement', engagement_id: e.id, label: `Open ${e.title}` }))

const noneFor = (client: string): Step[] => [
  ...words(
    `I couldn’t find an active engagement for **${client}**. Create one under **Engagements** (New engagement) and I can track its hours.`,
  ),
  done(120),
]

const problem = (error: unknown): Step[] => [
  ...words(`I couldn’t reach your engagements: ${error instanceof Error ? error.message : error}`),
  done(60),
]

export async function hoursLeftAnswer(client: string): Promise<Step[]> {
  try {
    const list = await engagements({ status: 'active', ...(client && { q: client }) })
    if (list.length === 0) return [status('Looking up engagements'), ...noneFor(client || 'you')]
    const rows = list
      .map((e) => {
        const p = e.current_period
        return `| **${e.title}** | ${e.client.name} | ${p ? show(p.used, e.unit) : '—'} of ${p ? show(p.quantity, e.unit) : '—'} | ${p ? show(p.remaining, e.unit) : '—'} | ${p ? formatDate(p.ends_on) : '—'} |`
      })
      .join('\n')
    return [
      status('Looking up engagements'),
      ...words(`Here is what is left${client ? ` for **${client}**` : ''}:\n\n`),
      ...lines(
        `| Engagement | Client | Used | Left | Period ends |\n| --- | --- | ---: | ---: | --- |\n${rows}\n`,
      ),
      { event: { type: 'actions', actions: openActions(list) }, wait: 120 },
      done(480),
    ]
  } catch (error) {
    return problem(error)
  }
}

export async function toInvoiceAnswer(): Promise<Step[]> {
  try {
    const list = await engagements({ attention: 'to_invoice' })
    if (list.length === 0)
      return [
        status('Checking what to invoice'),
        ...words('Nothing needs invoicing right now.'),
        done(90),
      ]
    const rows = list
      .map(
        (e) =>
          `| **${e.title}** | ${e.client.name} | ${e.current_period ? formatDate(e.current_period.ends_on) : '—'} |`,
      )
      .join('\n')
    return [
      status('Checking what to invoice'),
      ...words(`**${list.length} engagements** have work waiting to be invoiced:\n\n`),
      ...lines(`| Engagement | Client | Period ends |\n| --- | --- | --- |\n${rows}\n`),
      { event: { type: 'actions', actions: openActions(list) }, wait: 120 },
      done(420),
    ]
  } catch (error) {
    return problem(error)
  }
}

type PendingLog = { engagement: Engagement; request: LogRequest }
/** Logs waiting for the user's OK, by `conversation:confirmation`. */
export const pendingLogs = new Map<string, PendingLog>()

function confirmLog(
  conversation: string,
  engagement: Engagement,
  request: LogRequest,
  text: string,
): Step[] {
  const asked = requestedUnit(text)
  if (asked && engagement.unit !== asked)
    return [
      ...words(
        `“${engagement.title}” is tracked in ${PLURAL[engagement.unit ?? 'piece'] ?? 'units'}. How many ${PLURAL[engagement.unit ?? 'piece'] ?? 'units'} should I log?`,
      ),
      done(80),
    ]
  const confirmation: HeidiConfirmation = {
    type: 'confirmation',
    id: `cnf_${Date.now()}`,
    title: `Log ${show(request.quantity, engagement.unit)} for ${engagement.client.name}?`,
    body: `This adds ${show(request.quantity, engagement.unit)} dated today to “${engagement.title}”${request.note ? `: ${request.note}` : ''}.`,
    confirm_label: 'Log it',
    tone: 'default',
  }
  pendingLogs.set(`${conversation}:${confirmation.id}`, { engagement, request })
  return [
    ...words(`I’ll log it on **${engagement.title}**. I need your OK before writing.`),
    // The turn pauses here: no `done` until /chat/confirm answers.
    { event: confirmation, wait: 200 },
  ]
}

const optionOf = (e: Engagement) => `${e.title} (#${e.number})`

export async function logAnswer(
  conversation: string,
  request: LogRequest,
  text: string,
): Promise<Step[]> {
  try {
    const list = await engagements({ status: 'active', q: request.client })
    const first = list[0]
    if (!first) return [status('Looking up engagements'), ...noneFor(request.client)]
    if (list.length === 1)
      return [status('Looking up engagements'), ...confirmLog(conversation, first, request, text)]
    const form: HeidiForm = {
      id: 'log_engagement',
      question: 'Which engagement should I log it on?',
      fields: [
        { kind: 'choice', name: 'Engagement', label: 'Engagement', options: list.map(optionOf) },
      ],
    }
    return [
      status('Looking up engagements'),
      ...words(`**${request.client}** has ${list.length} active engagements.`),
      { event: { type: 'form', form }, wait: 120 },
      done(260),
    ]
  } catch (error) {
    return problem(error)
  }
}

/** The answer to the choice form ("Engagement: Title (#3)"), with the request found in the history. */
export async function chosenEngagementAnswer(
  conversation: string,
  message: string,
  asked: string | undefined,
): Promise<Step[]> {
  const request = asked ? parseLogRequest(asked) : null
  const number = /\(#(\d+)\)\s*$/.exec(message)?.[1]
  if (!request || !number) return [...words('Tell me again what to log and where.'), done(40)]
  try {
    const engagement = (await engagements({ status: 'active', q: request.client })).find(
      (e) => String(e.number) === number,
    )
    if (!engagement) return noneFor(request.client)
    return confirmLog(conversation, engagement, request, asked ?? '')
  } catch (error) {
    return problem(error)
  }
}

/** Writes the confirmed entry with the session's CSRF token. */
export async function writeLog({ engagement, request }: PendingLog): Promise<Step[]> {
  try {
    const session = await call('/session')
    if (!session.ok) throw new Error(await failure(session))
    const { csrf_token: csrf }: { csrf_token: string } = await session.json()
    const response = await call(`/engagements/${encodeURIComponent(engagement.id)}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ quantity: request.quantity, note: request.note }),
    })
    if (!response.ok) return [...words(`I couldn’t log it: ${await failure(response)}`), done(80)]
    const { data }: { data: { entry: Entry; period: Period } } = await response.json()
    return [
      status('Logging the work', 600),
      ...words(
        `Logged **${show(data.entry.quantity, engagement.unit)}** on **${engagement.title}**. **${show(data.period.remaining, engagement.unit)}** left this period.`,
      ),
      { event: { type: 'actions', actions: openActions([engagement]) }, wait: 80 },
      done(140),
    ]
  } catch (error) {
    return problem(error)
  }
}

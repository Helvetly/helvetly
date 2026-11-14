import { formatChf, formatDate } from '@helvetly/ui/lib/format'
// Test-only scripted Heidi. Production and next dev use the Go endpoints;
// these handlers provide repeatable unit/story states, not model or business integration evidence.
import { delay, http, HttpResponse } from 'msw'

import type {
  HeidiAction,
  HeidiConfirmation,
  HeidiForm,
  HeidiMessage,
  HeidiPage,
  HeidiRecord,
  HeidiSuggestion,
} from '@/lib/heidi'

import { clients, expenses, invoices } from './data'
import {
  chosenEngagementAnswer,
  hoursLeftAnswer,
  logAnswer,
  parseLogRequest,
  pendingLogs,
  toInvoiceAnswer,
  writeLog,
} from './heidi-engagements'
import { done, lines, status, type Step, words } from './heidi-steps'

const STORE = 'helvetly:heidi-mock'
type Store = Record<string, HeidiMessage[]>

function load(): Store {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    return typeof value === 'object' && value !== null ? (value as Store) : {}
  } catch {
    return {}
  }
}

function save(store: Store) {
  try {
    localStorage.setItem(STORE, JSON.stringify(store))
  } catch {}
}

function append(conversation: string, message: HeidiMessage) {
  const store = load()
  store[conversation] = [...(store[conversation] ?? []), message]
  save(store)
}

const COMPANY = 'Muster Treuhand'

function overdueAnswer(): Step[] {
  const overdue = invoices.filter((invoice) => invoice.status === 'overdue')
  const total = overdue.reduce((sum, invoice) => sum + invoice.amount, 0)
  const first = overdue.toSorted((a, b) => b.amount - a.amount)[0]
  const records: HeidiRecord[] = overdue.map((invoice) => ({
    kind: 'invoice',
    id: invoice.id,
    title: invoice.number,
    detail: `${invoice.company} · due ${formatDate(invoice.due_date)}`,
    status: 'overdue',
    amount: invoice.amount.toFixed(2),
    currency: 'CHF',
  }))
  const actions: HeidiAction[] = first
    ? [
        {
          id: 'send_invoice',
          invoice_id: first.id,
          label: 'Send a reminder',
          subject: `Reminder: invoice ${first.number} from ${COMPANY}`,
        },
      ]
    : []
  return [
    status('Looking up overdue invoices'),
    status('Checking due dates', 500),
    ...words(
      overdue.length === 1
        ? `1 invoice is overdue, worth **${formatChf(total)}**.`
        : `${overdue.length} invoices are overdue, worth **${formatChf(total)}** in total.`,
    ),
    ...words(
      first
        ? ` The largest is **${first.number}** for ${first.company}; a friendly reminder usually works.`
        : '',
    ),
    { event: { type: 'records', records }, wait: 120 },
    { event: { type: 'actions', actions }, wait: 120 },
    done(860),
  ]
}

function expensesAnswer(): Step[] {
  const byCategory = new Map<string, { total: number; count: number }>()
  for (const expense of expenses) {
    const entry = byCategory.get(expense.category) ?? { total: 0, count: 0 }
    byCategory.set(expense.category, {
      total: entry.total + expense.amount,
      count: entry.count + 1,
    })
  }
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const vat = expenses.reduce((sum, expense) => sum + expense.vat, 0)
  const rows = [...byCategory]
    .toSorted(([, a], [, b]) => b.total - a.total)
    .map(([category, { total: sum, count }]) => `| ${category} | ${count} | ${formatChf(sum)} |`)
    .join('\n')
  const pending = expenses.filter((expense) => expense.status === 'pending').length
  return [
    status('Summing up this month’s expenses'),
    ...words(
      `This month you spent **${formatChf(total)}** across ${expenses.length} expenses. By category:\n\n`,
    ),
    ...lines(`| Category | Expenses | Total |\n| --- | ---: | ---: |\n${rows}\n`),
    ...words(
      `\nThat includes **${formatChf(vat)}** of VAT you can reclaim. ${pending} expenses are still \`pending\` approval.`,
    ),
    done(720),
  ]
}

const CLIENT_FORM: HeidiForm = {
  id: 'new_client',
  question: 'A few details and I’ll set the client up.',
  fields: [
    { kind: 'choice', name: 'type', label: 'Client type', options: ['Company', 'Person'] },
    {
      kind: 'choice',
      name: 'terms',
      label: 'Payment terms',
      options: ['10 days', '30 days', '60 days'],
    },
    { kind: 'record', name: 'copy', label: 'Copy settings from', record: 'client' },
  ],
}

function newClientAnswer(message: string): Step[] {
  return [
    status('Preparing a new client form', 450),
    ...words(`Sure — let’s add **${clientName(message)}**.`),
    { event: { type: 'form', form: CLIENT_FORM }, wait: 120 },
    done(240),
  ]
}

const clientName = (message: string) =>
  message.match(/(?:called|named)\s+(.+?)[.?!]*$/i)?.[1]?.trim() ?? 'the new client'

/** The answer to the client form ("Client type: Company" lines), in the conversation's terms. */
function createdClientAnswer(conversation: string, message: string): Step[] {
  const history = load()[conversation] ?? []
  const asked = history.findLast(
    (entry) =>
      entry.role === 'user' && /client/i.test(entry.text) && !/^client type:/im.test(entry.text),
  )
  const name = asked ? clientName(asked.text) : 'the new client'
  const terms = message.match(/Payment terms: (.+)/)?.[1] ?? '30 days'
  clients.unshift({
    id: `cli_${Date.now()}`,
    company: name === 'the new client' ? 'New client' : name,
    contact: '—',
    city: '—',
    open_balance: 0,
    status: 'new',
  })
  return [
    status('Creating the client', 700),
    ...words(`Done — **${name}** is in your clients with ${terms} payment terms.`),
    {
      event: { type: 'actions', actions: [{ id: 'create_invoice', label: 'Create an invoice' }] },
      wait: 80,
    },
    done(310),
  ]
}

const pendingDeletes = new Map<string, string>()

function deleteAnswer(conversation: string): Step[] {
  const client = clients.find((entry) => entry.open_balance === 0 && entry.status !== 'new')
  if (!client) return [...words('I couldn’t find a client I can safely delete.'), done(90)]
  const confirmation: HeidiConfirmation = {
    type: 'confirmation',
    id: `cnf_${Date.now()}`,
    title: `Delete ${client.company}?`,
    body: `${client.company} has no open invoices. Deleting removes the client and their contact details; invoices you already sent stay in your records.`,
    confirm_label: 'Delete client',
    tone: 'destructive',
  }
  pendingDeletes.set(`${conversation}:${confirmation.id}`, client.id)
  return [
    status('Finding the client'),
    ...words(`I found **${client.company}** in ${client.city}. I need your OK before deleting it.`),
    // The turn pauses here: no `done` until /chat/confirm answers.
    { event: confirmation, wait: 200 },
  ]
}

function genericAnswer(message: string, page: string): Step[] {
  if (/brief me/i.test(message)) {
    const overdue = invoices.filter((invoice) => invoice.status === 'overdue').length
    return [
      status(`Reading your ${page === 'dashboard' ? 'workspace' : page}`),
      ...words(
        `Here’s the short version:\n\n- **${overdue} invoices are overdue** — the biggest is with Keller Holzbau AG.\n- ${expenses.filter((e) => e.status === 'pending').length} expenses wait for approval.\n- You have ${clients.length} clients; ${clients.filter((c) => c.status === 'new').length} were added recently.\n\nWant me to start with the overdue invoices?`,
      ),
      {
        event: {
          type: 'actions',
          actions: [{ id: 'list_overdue_invoices', label: 'Show overdue invoices' }],
        },
        wait: 80,
      },
      done(540),
    ]
  }
  return [
    status('Thinking', 500),
    ...words(
      'I can help with the day-to-day of your business:\n\n- **Invoices** — what’s open or overdue, and reminders\n- **Expenses** — monthly summaries and VAT\n- **Clients** — adding, finding and tidying them up\n\nTry “Which invoices are overdue?” or “Add a client called Sprüngli AG”.',
    ),
    done(320),
  ]
}

async function answer(conversation: string, message: string, page: string): Promise<Step[]> {
  const text = message.toLowerCase()
  if (/^client type:/im.test(message)) return createdClientAnswer(conversation, message)
  if (/^engagement:/im.test(message)) {
    const history = load()[conversation] ?? []
    const asked = history.findLast((entry) => entry.role === 'user' && parseLogRequest(entry.text))
    return chosenEngagementAnswer(conversation, message, asked?.text)
  }
  const log = parseLogRequest(message)
  if (log) return logAnswer(conversation, log, message)
  if (/needs?\s+invoic|to\s+invoice|zu\s+verrechnen|noch\s+verrechnen|abrechnen/.test(text))
    return toInvoiceAnswer()
  if (
    /(hours?|days?|stunden|budget|engagements?).*(left|remaining|übrig|rest)|(left|remaining).*(hours?|engagements?)/.test(
      text,
    )
  )
    return hoursLeftAnswer(
      message.match(/\b(?:for|of|with|für|bei)\s+(.+?)[?.!]*$/i)?.[1]?.trim() ?? '',
    )
  if (/unpaid|overdue|outstanding|reminder/.test(text)) return overdueAnswer()
  if (/expense|spend|spent/.test(text)) return expensesAnswer()
  if (/(add|new|create).*client/.test(text)) return newClientAnswer(message)
  if (/delete|remove/.test(text)) return deleteAnswer(conversation)
  return genericAnswer(message, page)
}

const encoder = new TextEncoder()

/** Streams the steps as SSE and records the assistant's message once it has ended. */
function stream(conversation: string, steps: Step[], request: Request) {
  const message: HeidiMessage = { id: `msg_${Date.now()}`, role: 'assistant', text: '' }
  let next = 0
  let recorded = false
  // What was said so far is kept even when the reader stops the answer.
  const record = () => {
    if (!recorded) append(conversation, message)
    recorded = true
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const step = steps[next++]
      if (!step || request.signal.aborted) {
        record()
        controller.close()
        return
      }
      await delay(step.wait)
      const { event } = step
      if (event.type === 'text') message.text += event.value
      if (event.type === 'actions') message.actions = event.actions
      if (event.type === 'records') message.records = event.records
      if (event.type === 'form') message.form = event.form
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    },
    cancel: record,
  })
  return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

const SUGGESTIONS: (HeidiSuggestion & { pages: HeidiPage[] })[] = [
  {
    title: 'Unpaid invoices',
    prompt: 'Which invoices are still unpaid?',
    pages: ['invoices', 'dashboard'],
  },
  {
    title: 'Overdue invoices',
    prompt: 'Which invoices are overdue?',
    pages: ['invoices', 'dashboard'],
  },
  {
    title: 'This month’s revenue',
    prompt: 'How much did we invoice this month?',
    pages: ['dashboard'],
  },
  {
    title: 'This month’s expenses',
    prompt: 'Summarize this month’s expenses',
    pages: ['expenses'],
  },
  { title: 'Top clients', prompt: 'Who are my top clients this year?', pages: ['clients'] },
  {
    title: 'Hours left',
    prompt: 'How many hours are left for Müller?',
    pages: ['engagements', 'clients'],
  },
  { title: 'Log hours', prompt: 'Log 2 h for Müller: Konjunktiv II', pages: ['engagements'] },
  { title: 'To invoice', prompt: 'What needs invoicing?', pages: ['engagements', 'invoices'] },
  { title: 'Add a client', prompt: 'Add a client called Sprüngli AG', pages: ['clients'] },
  { title: 'New invoice', prompt: 'Help me create a new invoice', pages: ['invoices'] },
  {
    title: 'Recent documents',
    prompt: 'Which documents were added recently?',
    pages: ['documents'],
  },
  { title: 'Signatures', prompt: 'How do I send a PDF for signature?', pages: ['documents'] },
  {
    title: 'Products',
    prompt: 'How do I add products and services to my catalogue?',
    pages: ['products'],
  },
  { title: 'Invite a colleague', prompt: 'How do I invite a colleague?', pages: ['members'] },
  { title: 'Change plan', prompt: 'How do I choose or change my plan?', pages: ['billing'] },
  { title: 'Limits', prompt: 'What happens when I reach a plan limit?', pages: ['billing'] },
  { title: 'Close a month', prompt: 'How do I close a month?', pages: ['settings'] },
  { title: 'VAT return', prompt: 'How do I prepare the Swiss VAT return?', pages: ['settings'] },
]

/** What to ask about the client open in its drawer, as the API words it. */
const clientSuggestions = (name: string): HeidiSuggestion[] => [
  { title: 'Overdue invoices', prompt: `Which invoices are overdue for ${name}?` },
  { title: 'Recent invoices', prompt: `Show recent invoices for ${name}` },
  { title: 'Hours left', prompt: `How many hours are left for ${name}?` },
]

export const heidiHandlers = [
  http.post('/api/v1/heidi/chat', async ({ request }) => {
    const form = await request.formData()
    const message = String(form.get('message') ?? '').trim()
    const conversation = String(form.get('conversation_id') ?? '')
    if (!message || message.length > 4000 || !/^[\w-]{1,32}$/.test(conversation)) {
      return HttpResponse.json(
        { error: { code: 'invalid_request', message: 'The message or conversation is invalid.' } },
        { status: 400 },
      )
    }
    const attachments = form
      .getAll('files[]')
      .flatMap((file) => (file instanceof File ? [file.name] : []))
    append(conversation, { id: `msg_${Date.now()}_u`, role: 'user', text: message, attachments })
    const steps = await answer(conversation, message, String(form.get('page') ?? 'dashboard'))
    return stream(conversation, steps, request)
  }),

  http.post('/api/v1/heidi/chat/confirm', async ({ request }) => {
    const body: unknown = await request.json()
    const {
      conversation_id: conversation,
      confirmation_id: id,
      approved,
    } = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    const key = `${String(conversation)}:${String(id)}`
    const clientId = pendingDeletes.get(key)
    const log = pendingLogs.get(key)
    if (typeof conversation !== 'string' || !(clientId || log)) {
      return HttpResponse.json(
        { error: { code: 'invalid_request', message: 'This confirmation was already answered.' } },
        { status: 400 },
      )
    }
    pendingDeletes.delete(key)
    pendingLogs.delete(key)
    if (approved !== true) {
      return stream(
        conversation,
        [...words('Okay — I left everything as it was.'), done(60)],
        request,
      )
    }
    if (log) return stream(conversation, await writeLog(log), request)
    const index = clients.findIndex((client) => client.id === clientId)
    const [removed] = clients.splice(index, 1)
    return stream(
      conversation,
      [status('Deleting the client', 700), ...words(`Deleted **${removed?.company}**.`), done(120)],
      request,
    )
  }),

  http.get('/api/v1/heidi/conversations', async () => {
    await delay(150)
    const data = Object.entries(load())
      .filter(([, messages]) => messages.length)
      .toReversed()
      .map(([id, messages]) => ({
        id,
        title: messages.find((message) => message.role === 'user')?.text.slice(0, 120) ?? '',
        snippet:
          messages
            .findLast((message) => message.role === 'assistant' && message.text)
            ?.text.slice(0, 160) ?? '',
        messages: messages.length,
        updated_at: new Date().toISOString(),
      }))
    return HttpResponse.json({ data })
  }),

  http.get('/api/v1/heidi/conversations/:id', async ({ params }) => {
    await delay(200)
    const messages = load()[String(params.id)]
    return messages
      ? HttpResponse.json({ data: messages })
      : HttpResponse.json(
          { error: { code: 'not_found', message: 'No such conversation.' } },
          { status: 404 },
        )
  }),

  http.get('/api/v1/heidi/usage', async () => {
    await delay(150)
    return HttpResponse.json({
      period: '2026-11',
      tokens_used: 318_400,
      tokens_included: 500_000,
      tokens_purchased: 0,
      tokens_remaining: 181_600,
    })
  }),

  http.get('/api/v1/heidi/suggestions', async ({ request }) => {
    await delay(150)
    const query = new URL(request.url).searchParams
    const page = query.get('page')
    const client = page === 'clients' && clients.find((entry) => entry.id === query.get('client'))
    const ranked = SUGGESTIONS.toSorted(
      (a, b) =>
        Number(b.pages.includes(page as HeidiPage)) - Number(a.pages.includes(page as HeidiPage)),
    )
    return HttpResponse.json({
      data: [
        ...(client ? clientSuggestions(client.company) : []),
        ...ranked.map(({ title, prompt }) => ({ title, prompt })),
      ].slice(0, 8),
    })
  }),
]

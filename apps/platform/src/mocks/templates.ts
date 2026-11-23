// The Go API serves templates now; this stays as the fake API the lib and screen tests run against:
// templates kept in localStorage, generating files nothing in Documents and sends nothing.
import { bypass, delay, http, HttpResponse } from 'msw'

import type {
  ContractDraft,
  GenerateRequest,
  QuoteContract,
  Template,
  TemplateInput,
} from '@/lib/templates'

const STORAGE_KEY = 'helvetly:mock-templates'

function load(): Template[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

let templates: Template[] | null = null
const all = () => (templates ??= load())
const save = (next: Template[]) => {
  templates = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 12)}`
const notFound = () =>
  HttpResponse.json(
    { error: { code: 'not_found', message: 'Template not found.' } },
    { status: 404 },
  )
const invalid = (fields: Record<string, string>) =>
  HttpResponse.json(
    { error: { code: 'validation_failed', message: 'Check the fields.', details: { fields } } },
    { status: 422 },
  )

function check(body: TemplateInput) {
  const fields: Record<string, string> = {}
  if (!body.name?.trim()) fields.name = 'Enter a name.'
  if (!body.document_id) fields.document_id = 'Choose a PDF.'
  if (!body.fields?.length) fields.fields = 'Place at least one field.'
  return fields
}

function build(body: TemplateInput, existing?: Template): Template {
  const now = new Date().toISOString()
  return {
    id: existing?.id ?? id('tpl'),
    name: body.name.trim(),
    description: body.description,
    // The real API reads the name from Documents; the editor sends only the id.
    document: { id: body.document_id, name: existing?.document?.name ?? 'Template.pdf' },
    signers: body.signers,
    fields: body.fields.map((field) => ({ ...field, id: id('tfd') })),
    used_count: existing?.used_count ?? 0,
    last_used_at: existing?.last_used_at ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  }
}

/** The PDF's name, as the API will read it: from the real Documents API. */
async function documentName(request: Request, documentId: string) {
  try {
    const url = new URL(`/api/v1/documents/${encodeURIComponent(documentId)}`, request.url)
    const res = await fetch(bypass(url))
    const body: { data?: { name?: string } } = res.ok ? await res.json() : {}
    return body.data?.name ?? null
  } catch {
    return null
  }
}

const named = (template: Template, name: string | null) =>
  name && template.document ? { ...template, document: { ...template.document, name } } : template

// Contracts made from quotes, newest first, numbered <year>/C/<seq> as with the default quote format.
const contracts = new Map<string, QuoteContract[]>()
let contractSeq = 0

/**
 * A contract draft as the API answers it: the first custom field matched by name ("quote"), the
 * others written by the model ("ai"); a quote without a template is refused.
 */
function contractDraft(template: Template, quoteId: string, useAI: boolean): ContractDraft {
  const custom = template.fields.filter((field) => field.kind === 'custom')
  const out: ContractDraft = {
    fields: {},
    sources: {},
    ai: useAI ? 'used' : 'skipped',
    quote: { id: quoteId, number: '2026/Q/001' },
  }
  custom.forEach((field, index) => {
    if (index > 0 && !useAI) return
    out.fields[field.id] = index === 0 ? 'CHF 4’000.00' : `${field.label ?? 'Field'} from the quote`
    out.sources[field.id] = index === 0 ? 'quote' : 'ai'
  })
  if (custom.length <= 1) out.ai = 'not_needed'
  return out
}

export const templateHandlers = [
  http.post<{ id: string }, { template_id: string; use_ai: boolean }>(
    '/api/v1/quotes/:id/contract-draft',
    async ({ params, request }) => {
      await delay()
      const body = await request.json()
      const template = all().find((entry) => entry.id === body.template_id)
      if (!template) return invalid({ template_id: 'Choose a template.' })
      return HttpResponse.json({ data: contractDraft(template, params.id, body.use_ai) })
    },
  ),
  http.get('/api/v1/quotes/contract-counts', () =>
    HttpResponse.json({
      data: Object.fromEntries([...contracts].map(([quote, list]) => [quote, list.length])),
    }),
  ),
  http.get<{ id: string }>('/api/v1/quotes/:id/contracts', ({ params }) =>
    HttpResponse.json({ data: contracts.get(params.id) ?? [] }),
  ),
  http.get('/api/v1/templates', async () => {
    await delay()
    return HttpResponse.json({
      data: all().toSorted((a, b) => b.updated_at.localeCompare(a.updated_at)),
    })
  }),
  http.get<{ id: string }>('/api/v1/templates/:id', async ({ params }) => {
    await delay()
    const template = all().find((entry) => entry.id === params.id)
    return template ? HttpResponse.json({ data: template }) : notFound()
  }),
  http.post<never, TemplateInput>('/api/v1/templates', async ({ request }) => {
    await delay()
    const body = await request.json()
    const problems = check(body)
    if (Object.keys(problems).length) return invalid(problems)
    const template = named(build(body), await documentName(request, body.document_id))
    save([template, ...all()])
    return HttpResponse.json({ data: template }, { status: 201 })
  }),
  http.put<{ id: string }, TemplateInput>('/api/v1/templates/:id', async ({ params, request }) => {
    await delay()
    const existing = all().find((entry) => entry.id === params.id)
    if (!existing) return notFound()
    const body = await request.json()
    const problems = check(body)
    if (Object.keys(problems).length) return invalid(problems)
    const template = named(build(body, existing), await documentName(request, body.document_id))
    save(all().map((entry) => (entry.id === existing.id ? template : entry)))
    return HttpResponse.json({ data: template })
  }),
  http.delete<{ id: string }>('/api/v1/templates/:id', async ({ params }) => {
    await delay()
    save(all().filter((entry) => entry.id !== params.id))
    return new HttpResponse(null, { status: 204 })
  }),
  http.post<{ id: string }, GenerateRequest>(
    '/api/v1/templates/:id/documents',
    async ({ params, request }) => {
      await delay(900)
      const body = await request.json()
      const current = all()
      const index = current.findIndex((entry) => entry.id === params.id)
      const template = current[index]
      if (!template) return notFound()
      if (!body.title?.trim()) return invalid({ title: 'Enter a title.' })
      const now = new Date().toISOString()
      save(
        current.with(index, {
          ...template,
          used_count: template.used_count + 1,
          last_used_at: now,
        }),
      )
      const document = { id: id('doc'), name: `${body.title.trim()}.pdf` }
      let number: string | null = null
      if (body.quote_id) {
        number = `${now.slice(0, 4)}/C/${String(++contractSeq).padStart(3, '0')}`
        document.name = `${number.replaceAll('/', '-')}.pdf`
        const made: QuoteContract = {
          document_id: document.id,
          number,
          name: document.name,
          created_at: now,
          signature: null,
        }
        contracts.set(body.quote_id, [made, ...(contracts.get(body.quote_id) ?? [])])
      }
      return HttpResponse.json(
        {
          data: {
            contract_number: number,
            document,
            signature_request_id: body.delivery.type === 'signature' ? id('sig') : null,
            emailed_to: body.delivery.type === 'email' ? body.delivery.to : null,
          },
        },
        { status: 201 },
      )
    },
  ),
]

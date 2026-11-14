import { getResponse } from 'msw'
import type * as Msw from 'msw'

import type { GenerateRequest, Template } from '@/lib/templates'

vi.mock('msw', async (original) => ({
  ...(await original<typeof Msw>()),
  delay: async () => {},
}))

const storageKey = 'helvetly:mock-templates'
const origin = 'http://localhost'
const generation: GenerateRequest = {
  client_id: 'cli_1',
  title: 'Agreement',
  values: {},
  delivery: { type: 'save' },
}

function template(id: string): Template {
  return {
    id,
    name: id,
    description: null,
    document: { id: 'doc_source', name: 'Source.pdf' },
    signers: [],
    fields: [],
    used_count: 0,
    last_used_at: null,
    created_at: '2026-11-08T00:00:00Z',
    updated_at: '2026-11-08T00:00:00Z',
  }
}

async function setup(rows: Template[]) {
  vi.resetModules()
  localStorage.setItem(storageKey, JSON.stringify(rows))
  const { templateHandlers } = await import('./templates')
  return (request: Request) => getResponse(templateHandlers, request, { baseUrl: origin })
}

function generateRequest(id: string) {
  return new Request(`${origin}/api/v1/templates/${id}/documents`, {
    method: 'POST',
    body: JSON.stringify(generation),
  })
}

function pendingBody(request: Request) {
  const started = Promise.withResolvers<void>()
  const body = Promise.withResolvers<GenerateRequest>()
  vi.spyOn(request, 'json').mockImplementation(() => {
    started.resolve()
    return body.promise
  })
  return { started: started.promise, resume: () => body.resolve(generation) }
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(storageKey)
})

test('generation cannot resurrect a concurrently deleted template or replace an unrelated one', async () => {
  const unrelated = template('tpl_b')
  const respond = await setup([template('tpl_a'), unrelated])
  const request = generateRequest('tpl_a')
  const body = pendingBody(request)
  const pending = respond(request)
  await body.started

  const deleted = await respond(
    new Request(`${origin}/api/v1/templates/tpl_a`, { method: 'DELETE' }),
  )
  expect(deleted?.status).toBe(204)
  body.resume()
  const response = await pending

  expect(response?.status).toBe(404)
  expect(JSON.parse(localStorage.getItem(storageKey) ?? '[]')).toEqual([unrelated])
})

test('generation finds its current position after an earlier template is deleted', async () => {
  const target = template('tpl_b')
  const respond = await setup([template('tpl_a'), target])
  const request = generateRequest('tpl_b')
  const body = pendingBody(request)
  const pending = respond(request)
  await body.started

  await respond(new Request(`${origin}/api/v1/templates/tpl_a`, { method: 'DELETE' }))
  body.resume()
  const response = await pending

  expect(response?.status).toBe(201)
  expect(await response?.json()).toMatchObject({
    data: {
      document: { name: 'Agreement.pdf' },
      signature_request_id: null,
      emailed_to: null,
    },
  })
  expect(JSON.parse(localStorage.getItem(storageKey) ?? '[]')).toEqual([
    { ...target, used_count: 1, last_used_at: expect.any(String) },
  ])
})

test('overlapping generations increment the current usage without losing another completion', async () => {
  const target = template('tpl_a')
  const unrelated = template('tpl_b')
  const respond = await setup([target, unrelated])
  const request = generateRequest('tpl_a')
  const body = pendingBody(request)
  const pending = respond(request)
  await body.started

  expect((await respond(generateRequest('tpl_a')))?.status).toBe(201)
  body.resume()
  expect((await pending)?.status).toBe(201)

  expect(JSON.parse(localStorage.getItem(storageKey) ?? '[]')).toEqual([
    { ...target, used_count: 2, last_used_at: expect.any(String) },
    unrelated,
  ])
})

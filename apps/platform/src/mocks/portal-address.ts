// The client portal's address (GET/PUT /workspace/portal and its availability check), as the Go API answers.
import { http, HttpResponse } from 'msw'

const BASE = 'https://portal.helvetly.com/w/'
const RESERVED = new Set([
  'api',
  'w',
  'login',
  'logout',
  'assets',
  'portal',
  'helvetly',
  'admin',
  'www',
])
/** Another workspace's current or earlier slug. */
const TAKEN = new Set(['acme', 'beta-treuhand'])

let slug = 'mueller-treuhand'
let enabled = true

/** `on` false: the workspace turned its whole portal off. */
export function resetPortalAddress(to = 'mueller-treuhand', on = true) {
  slug = to
  enabled = on
}

const problemOf = (value: string) => {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(value)) return 'invalid'
  if (RESERVED.has(value)) return 'reserved'
  if (TAKEN.has(value)) return 'taken'
  return null
}

const address = () => ({ data: { slug, url: `${BASE}${slug}/`, enabled } })

export const portalAddressHandlers = [
  http.get('/api/v1/workspace/portal/availability', ({ request }) => {
    const problem = problemOf(new URL(request.url).searchParams.get('slug') ?? '')
    return HttpResponse.json({ data: { available: problem === null, problem } })
  }),
  http.get('/api/v1/workspace/portal', () => HttpResponse.json(address())),
  http.put<never, { enabled: boolean }>('/api/v1/workspace/portal/access', async ({ request }) => {
    enabled = (await request.json()).enabled
    return HttpResponse.json(address())
  }),
  http.put<never, { slug: string }>('/api/v1/workspace/portal', async ({ request }) => {
    const wanted = (await request.json()).slug
    const problem = wanted === slug ? null : problemOf(wanted)
    if (problem)
      return HttpResponse.json(
        {
          error: {
            code: `slug_${problem}`,
            message: 'Choose another address.',
            details: { fields: { slug: problem } },
          },
        },
        { status: problem === 'taken' ? 409 : 422 },
      )
    slug = wanted
    return HttpResponse.json(address())
  }),
]

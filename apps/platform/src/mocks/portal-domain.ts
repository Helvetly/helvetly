// The client portal's custom domain (GET/PUT/DELETE /workspace/portal/domain and its check), as the Go API answers.
import { http, HttpResponse } from 'msw'

import type { DomainStage, PortalDomain, PortalDomainSettings } from '@/lib/workspaces'

const PATH = '/api/v1/workspace/portal/domain'
const TARGET = 'portal.helvetly.com'

export const portalDomain = (
  hostname = 'portal.mueller-treuhand.ch',
  stage: DomainStage = 'dns',
): PortalDomain => ({
  hostname,
  status: stage === 'active' ? 'active' : stage === 'problem' ? 'failed' : 'pending',
  stage,
  problem: stage === 'problem' ? 'dns' : null,
  detail: stage === 'problem' ? `custom hostname does not CNAME to this zone.` : null,
  records: [
    { type: 'CNAME', name: hostname, value: TARGET },
    {
      type: 'TXT',
      name: `_cf-custom-hostname.${hostname}`,
      value: '0f2c8a1e-6b7d-4c39-9e51-2d7a4b8c3f10',
    },
  ],
  last_checked_at: '2026-11-19T10:00:00Z',
  created_at: '2026-11-19T09:58:00Z',
})

let state: PortalDomainSettings = { enabled: true, target: TARGET, domain: null }

/** `domain` null: none yet; `enabled` false: the server has no Cloudflare settings. */
export function resetPortalDomain(domain: PortalDomain | null = null, enabled = true) {
  state = { enabled, target: TARGET, domain }
}

const refuse = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status })

/** Hosts the mock refuses as the API would: one per refusal, plus Cloudflare not answering. */
function refusal(hostname: string) {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname))
    return refuse(422, 'domain_invalid', 'Enter a valid domain.')
  if (hostname.split('.').length < 3) return refuse(422, 'domain_apex', 'Use a subdomain.')
  if (hostname.endsWith('helvetly.com'))
    return refuse(422, 'domain_reserved', 'This domain is reserved.')
  if (hostname === 'portal.acme.ch')
    return refuse(409, 'domain_taken', 'Another workspace uses this domain.')
  if (hostname === 'portal.down.ch')
    return refuse(
      502,
      'domain_unavailable',
      'The domain service is not answering. Try again in a few minutes.',
    )
  return null
}

/** Every check moves a pending domain one stage on: DNS, then the certificate, then active. */
const NEXT: Record<DomainStage, DomainStage> = {
  dns: 'certificate',
  certificate: 'active',
  active: 'active',
  problem: 'active',
}

export const portalDomainHandlers = [
  http.get(PATH, () => HttpResponse.json({ data: state })),
  http.put<never, { hostname: string }>(PATH, async ({ request }) => {
    const { hostname } = await request.json()
    if (state.domain)
      return refuse(409, 'domain_exists', 'This workspace already has a custom domain.')
    const refused = refusal(hostname)
    if (refused) return refused
    state = { ...state, domain: portalDomain(hostname) }
    return HttpResponse.json({ data: state }, { status: 201 })
  }),
  http.post(`${PATH}/check`, () => {
    if (state.domain)
      state = { ...state, domain: portalDomain(state.domain.hostname, NEXT[state.domain.stage]) }
    return HttpResponse.json({ data: state })
  }),
  http.delete(PATH, () => {
    state = { ...state, domain: null }
    return new HttpResponse(null, { status: 204 })
  }),
]

/** A plan without custom domains: the API refuses adding one. */
export const portalDomainLockedHandlers = [
  http.put(PATH, () =>
    HttpResponse.json(
      {
        error: {
          code: 'feature_not_in_plan',
          message: 'Your plan doesn’t include a custom portal domain.',
          details: { feature: 'custom_portal_domain', required_plan: 'business' },
        },
      },
      { status: 403 },
    ),
  ),
  ...portalDomainHandlers,
]

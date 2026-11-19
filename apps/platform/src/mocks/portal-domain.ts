// The client portal's custom domain (GET/PUT/DELETE /workspace/portal/domain and its check), as the Go API answers.
import { http, HttpResponse } from 'msw'

import type {
  DomainProblem,
  DomainStage,
  PortalDomain,
  PortalDomainSettings,
} from '@/lib/workspaces'

const PATH = '/api/v1/workspace/portal/domain'
const TARGET = 'portal.helvetly.com'
const RELEASES_AT = '2026-12-03T09:58:00Z'

/** Cloudflare's own words, as the API passes them on. */
const DETAILS: Record<DomainProblem, string> = {
  dns: 'custom hostname does not CNAME to this zone.',
  verification: '',
  certificate: '',
  blocked: '',
  taken: '',
  plan: '',
}

export const portalDomain = (
  hostname = 'portal.mueller-treuhand.ch',
  stage: DomainStage = 'dns',
  problem: DomainProblem | null = stage === 'problem'
    ? 'dns'
    : stage === 'certificate'
      ? 'certificate'
      : null,
): PortalDomain => ({
  hostname,
  status: stage === 'active' ? 'active' : stage === 'problem' ? 'failed' : 'pending',
  stage,
  problem,
  detail: problem ? DETAILS[problem] || null : null,
  records: [
    { type: 'CNAME', name: hostname, value: TARGET },
    {
      type: 'TXT',
      name: `_cf-custom-hostname.${hostname}`,
      value: '5cc0f6b2-8f5c-4c1e-9d0a-3e7b2a91c4d8',
    },
  ],
  verified_at:
    stage === 'active' || stage === 'certificate' || problem === 'plan'
      ? '2026-11-19T10:00:00Z'
      : null,
  last_checked_at: '2026-11-19T10:00:00Z',
  // A proven domain the plan turned off is kept, not released.
  releases_at: stage === 'active' || problem === 'plan' ? null : RELEASES_AT,
  created_at: '2026-11-19T09:58:00Z',
})

let state: PortalDomainSettings = { enabled: true, target: TARGET, domain: null }

/** `domain` null: none yet; `enabled` false: the server has no Cloudflare for SaaS settings. */
export function resetPortalDomain(domain: PortalDomain | null = null, enabled = true) {
  state = { enabled, target: TARGET, domain }
}

const refuse = (status: number, code: string, message: string, details?: object) =>
  HttpResponse.json({ error: { code, message, details } }, { status })

/** Hosts the mock refuses as the API would: one per refusal, plus Cloudflare not answering. */
function refusal(hostname: string) {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname))
    return refuse(422, 'domain_invalid', 'Enter a valid domain.')
  if (hostname.split('.').length < 3) return refuse(422, 'domain_apex', 'Use a subdomain.')
  if (hostname.endsWith('helvetly.com'))
    return refuse(422, 'domain_reserved', 'This domain is reserved.')
  if (hostname === 'portal.acme.ch')
    return refuse(409, 'domain_taken', 'This domain is already in use. Choose another one.')
  if (hostname === 'portal.claimed.ch')
    return refuse(
      409,
      'domain_taken',
      'Another workspace has added this domain without proving it owns it.',
      {
        verify: {
          type: 'TXT',
          name: '_helvetly-verify.portal.claimed.ch',
          value: 'helvetly-0a1b2c3d4e5f60718293a4b5c6d7e8f9',
        },
      },
    )
  if (hostname === 'portal.elsewhere.ch')
    return refuse(
      409,
      'domain_elsewhere',
      'This domain is connected to another service on Cloudflare. Remove it there first, then add it again.',
    )
  if (hostname === 'portal.down.ch')
    return refuse(
      502,
      'domain_unavailable',
      'The domain service did not answer. Try again in a minute.',
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

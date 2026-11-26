// Test-only fake for the Go account endpoints. Never registered in development or production.
import { delay, http, HttpResponse } from 'msw'

import type { Account, AccountSession, ApiToken, Provider } from '@/lib/account'
import { isTokenScope, TOKEN_RESOURCES, type TokenScope } from '@/lib/token-scopes'

const STORAGE_KEY = 'helvetly:mock-account'
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const sampleAccount = (): Account => ({
  identities: [
    { provider: 'email', email: 'pete@helvetly.example', created_at: '2026-09-02T08:14:00Z' },
    { provider: 'google', email: 'pete.k@example.com', created_at: '2026-09-02T08:15:00Z' },
  ],
  two_factor: { enabled: false, recovery_codes_left: 0 },
})

const isAccount = (value: unknown): value is Account =>
  typeof value === 'object' &&
  value !== null &&
  'identities' in value &&
  Array.isArray(value.identities) &&
  'two_factor' in value

function load(): Account {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isAccount(value)) return value
  } catch {}
  return sampleAccount()
}

let account: Account | null = null
const current = () => (account ??= load())
const save = (next: Account) => {
  account = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

const sampleSessions = (): AccountSession[] => [
  {
    id: 'ses_current',
    browser: 'Chrome 142',
    os: 'macOS',
    device: 'desktop',
    ip: '203.0.113.18',
    location: 'Zurich, Switzerland',
    workspace_name: 'My workspace',
    created_at: ago(60 * 26),
    last_active_at: ago(0),
    current: true,
  },
  {
    id: 'ses_iphone',
    browser: 'Safari',
    os: 'iOS 26',
    device: 'mobile',
    ip: '203.0.113.4',
    location: 'Zurich, Switzerland',
    workspace_name: 'My workspace',
    created_at: ago(60 * 24 * 5),
    last_active_at: ago(42),
    current: false,
  },
  {
    id: 'ses_ipad',
    browser: 'Safari',
    os: 'iPadOS 26',
    device: 'tablet',
    ip: '198.51.100.71',
    location: 'Basel, Switzerland',
    workspace_name: 'Side project',
    created_at: ago(60 * 24 * 12),
    last_active_at: ago(60 * 24 * 3),
    current: false,
  },
  {
    id: 'ses_windows',
    browser: 'Edge 141',
    os: 'Windows 11',
    device: 'desktop',
    ip: '198.51.100.9',
    location: null,
    workspace_name: 'My workspace',
    created_at: ago(60 * 24 * 20),
    last_active_at: ago(60 * 24 * 9),
    current: false,
  },
]
let sessions = sampleSessions()

export const sampleTokens = (): ApiToken[] => [
  {
    id: 'tok_claude',
    name: 'Claude',
    scopes: ['read:*', 'write:*'],
    prefix: 'hvt_K7QM',
    workspace: { id: 'wsp_mock', name: 'My workspace' },
    created_at: ago(60 * 24 * 14),
    last_used_at: ago(35),
    expires_at: new Date(Date.now() + 76 * 24 * 3_600_000).toISOString(),
  },
  {
    id: 'tok_report',
    name: 'Monthly report script',
    scopes: ['read:*'],
    prefix: 'hvt_2B9X',
    workspace: { id: 'wsp_side', name: 'Side project' },
    created_at: ago(60 * 24 * 40),
    last_used_at: null,
    expires_at: null,
  },
  {
    id: 'tok_books',
    name: 'Bookkeeping sync',
    scopes: ['read:expenses', 'read:invoices', 'write:invoices'],
    prefix: 'hvt_P4LD',
    workspace: { id: 'wsp_mock', name: 'My workspace' },
    created_at: ago(60 * 24 * 3),
    last_used_at: ago(60 * 5),
    expires_at: new Date(Date.now() + 362 * 24 * 3_600_000).toISOString(),
  },
]
let tokens = sampleTokens()

/** The API's stored form (auth/scopes.go): known scopes only, each write with its read, wildcards win. */
function canonicalScopes(raw: unknown): TokenScope[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const known = new Set<string>(['*', ...TOKEN_RESOURCES.map(({ name }) => name)])
  const granted = { read: new Set<string>(), write: new Set<string>() }
  for (const scope of raw) {
    const [action, resource = ''] = typeof scope === 'string' ? scope.split(':') : []
    if ((action !== 'read' && action !== 'write') || !known.has(resource)) return null
    granted[action].add(resource)
    if (action === 'write') granted.read.add(resource)
  }
  return (['read', 'write'] as const).flatMap((action) => {
    const all = granted[action].has('*')
    return [...granted[action]]
      .filter((resource) => resource === '*' || !all)
      .toSorted((a, b) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)))
      .map((resource) => `${action}:${resource}`)
      .filter(isTokenScope)
  })
}
const LIFETIMES = [30, 90, 365] as const
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const fail = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  HttpResponse.json(
    { error: { code, message, ...(fields ? { details: { fields } } : {}) } },
    { status },
  )
// Any six digits pass, except 000000, so the wrong-code path can be tried by hand.
const validCode = (code: unknown) =>
  typeof code === 'string' && /^\d{6}$/.test(code) && code !== '000000'
const recoveryCodes = () =>
  Array.from({ length: 10 }, () =>
    Array.from({ length: 2 }, () => Math.random().toString(36).slice(2, 7)).join('-'),
  )

// The uploaded photo's bytes, served back like the API's own photo URL.
let photo: { bytes: ArrayBuffer; type: string } | null = null
/** Your stored signature for contracts: its image (none at first) and place ("" = the workspace's city). */
let contractSignature: { image: { bytes: ArrayBuffer; type: string } | null; place: string } = {
  image: null,
  place: '',
}
const signatureView = () => ({
  data: {
    has_image: contractSignature.image !== null,
    place: contractSignature.place,
    default_place: 'Zürich',
  },
})

/** Back to the sample data; tests call it between cases. */
export function resetAccountMock() {
  memory = { enabled: true, reply_style: 'auto', topics: [] }
  account = sampleAccount()
  sessions = sampleSessions()
  tokens = sampleTokens()
  photo = null
  contractSignature = { image: null, place: '' }
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

let memory: { enabled: boolean; reply_style: string; topics: { title: string; count: number }[] } =
  { enabled: true, reply_style: 'auto', topics: [] }

const memoryView = () =>
  HttpResponse.json({
    ...memory,
    has_memory: memory.topics.length > 0 || memory.reply_style !== 'auto',
  })

export const accountHandlers = [
  http.get('/api/v1/heidi/memory', memoryView),
  http.patch('/api/v1/heidi/memory', async ({ request }) => {
    const update = (await request.json()) as Partial<typeof memory>
    memory =
      update.enabled === false
        ? { enabled: false, reply_style: 'auto', topics: [] }
        : { ...memory, ...update }
    return memoryView()
  }),
  http.delete('/api/v1/heidi/memory', () => {
    memory = { ...memory, reply_style: 'auto', topics: [] }
    return memoryView()
  }),
  // The account page asks for deleted workspaces; none by default (the restore stories bring their own).
  http.get('/api/v1/workspaces/deleted', () => HttpResponse.json({ data: [] })),
  http.put('/api/v1/account/avatar', async ({ request }) => {
    const file = (await request.formData()).get('file')
    if (!(file instanceof Blob) || !['image/png', 'image/jpeg'].includes(file.type))
      return fail(422, 'validation_failed', 'Upload the photo as a PNG or JPEG image.', {
        file: 'Upload the photo as a PNG or JPEG image.',
      })
    await delay()
    photo = { bytes: await file.arrayBuffer(), type: file.type }
    return HttpResponse.json({
      avatar_url: `/api/v1/users/usr_mock/avatar?v=${Math.random().toString(16).slice(2, 14)}`,
    })
  }),
  http.get('/api/v1/users/:id/avatar', () =>
    photo
      ? new HttpResponse(photo.bytes, { headers: { 'Content-Type': photo.type } })
      : fail(404, 'not_found', 'Not found.'),
  ),
  http.delete('/api/v1/account/avatar', async () => {
    await delay()
    photo = null
    return HttpResponse.json({ avatar_url: '' })
  }),

  http.get('/api/v1/account/contract-signature', () => HttpResponse.json(signatureView())),
  http.put<never, { place?: unknown }>(
    '/api/v1/account/contract-signature',
    async ({ request }) => {
      const { place } = await request.json()
      contractSignature.place = typeof place === 'string' ? place.trim() : ''
      return HttpResponse.json(signatureView())
    },
  ),
  http.put('/api/v1/account/contract-signature/image', async ({ request }) => {
    const file = (await request.formData()).get('file')
    if (!(file instanceof Blob) || !['image/png', 'image/jpeg'].includes(file.type))
      return fail(422, 'validation_failed', 'Upload the image as a PNG or JPEG.', {
        file: 'Upload the image as a PNG or JPEG.',
      })
    await delay()
    contractSignature.image = { bytes: await file.arrayBuffer(), type: file.type }
    return HttpResponse.json(signatureView())
  }),
  http.get('/api/v1/account/contract-signature/image', () =>
    contractSignature.image
      ? new HttpResponse(contractSignature.image.bytes, {
          headers: { 'Content-Type': contractSignature.image.type },
        })
      : fail(404, 'not_found', 'Not found.'),
  ),
  http.delete('/api/v1/account/contract-signature/image', () => {
    contractSignature.image = null
    return HttpResponse.json(signatureView())
  }),

  http.get('/api/v1/account', async () => {
    await delay()
    return HttpResponse.json({ data: current() })
  }),
  http.patch<never, { name?: unknown }>('/api/v1/account', async ({ request }) => {
    const { name } = await request.json()
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100)
      return fail(422, 'validation_failed', 'Check the fields.', {
        name: 'Enter a name of up to 100 characters.',
      })
    return HttpResponse.json({
      data: { id: 'usr_mock', email: 'pete@helvetly.example', name: name.trim(), avatar_url: null },
    })
  }),
  http.delete('/api/v1/account', () =>
    fail(
      409,
      'sole_owner',
      'You are the only owner of My workspace. Make someone else an owner or delete the workspace first.',
    ),
  ),
  http.post<never, { next?: string }>(
    '/api/v1/account/identities/google/start',
    async ({ request }) => {
      const { next = '/account' } = await request.json()
      const now = current()
      if (!now.identities.some((identity) => identity.provider === 'google'))
        save({
          ...now,
          identities: [
            ...now.identities,
            {
              provider: 'google',
              email: 'pete.k@example.com',
              created_at: new Date().toISOString(),
            },
          ],
        })
      return HttpResponse.json({ url: next })
    },
  ),
  http.delete<{ provider: Provider }>('/api/v1/account/identities/:provider', ({ params }) => {
    if (params.provider === 'email')
      return fail(409, 'invalid_state', 'Your email address is how Helvetly reaches you.')
    const now = current()
    save({ ...now, identities: now.identities.filter((i) => i.provider !== params.provider) })
    return new HttpResponse(null, { status: 204 })
  }),
  http.post('/api/v1/account/two-factor/setup', () => {
    if (current().two_factor.enabled)
      return fail(409, 'invalid_state', 'Two-factor authentication is already on.')
    return HttpResponse.json({
      data: {
        secret: SECRET,
        otpauth_url: `otpauth://totp/Helvetly:pete%40helvetly.example?secret=${SECRET}&issuer=Helvetly`,
        qr_svg: null,
      },
    })
  }),
  http.post<never, { code?: unknown }>('/api/v1/account/two-factor/enable', async ({ request }) => {
    const { code } = await request.json()
    if (!validCode(code))
      return fail(422, 'invalid_code', 'That code is not valid. Try the newest one.', {
        code: 'invalid',
      })
    const codes = recoveryCodes()
    save({ ...current(), two_factor: { enabled: true, recovery_codes_left: codes.length } })
    return HttpResponse.json({ data: { recovery_codes: codes } })
  }),
  http.delete<never, { code?: unknown }>('/api/v1/account/two-factor', async ({ request }) => {
    const { code } = await request.json()
    const recovery = typeof code === 'string' && /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(code)
    if (!validCode(code) && !recovery)
      return fail(422, 'invalid_code', 'That code is not valid.', { code: 'invalid' })
    save({ ...current(), two_factor: { enabled: false, recovery_codes_left: 0 } })
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('/api/v1/account/sessions', async () => {
    await delay()
    return HttpResponse.json({ data: sessions })
  }),
  http.delete<{ id: string }>('/api/v1/account/sessions/:id', ({ params }) => {
    const target = sessions.find((session) => session.id === params.id)
    if (!target) return fail(404, 'not_found', 'Not found.')
    if (target.current) return fail(409, 'current_session', 'Sign out to end this session.')
    sessions = sessions.filter((session) => session.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
  http.delete('/api/v1/account/sessions', () => {
    sessions = sessions.filter((session) => session.current)
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('/api/v1/account/tokens', async () => {
    await delay()
    return HttpResponse.json({ data: tokens })
  }),
  http.post<never, { name?: unknown; scopes?: unknown; expires_in_days?: unknown }>(
    '/api/v1/account/tokens',
    async ({ request }) => {
      const body = await request.json()
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const scopes = canonicalScopes(body.scopes)
      const days = body.expires_in_days ?? null
      const expiry = days === null ? null : LIFETIMES.find((lifetime) => lifetime === days)
      const fields: Record<string, string> = {}
      if (!name || name.length > 80) fields.name = 'Enter a name of up to 80 characters.'
      if (!scopes)
        fields.scopes =
          'Choose what the token may do: read or write, for every resource or for some.'
      if (expiry === undefined) fields.expires_in_days = 'Choose 30, 90 or 365 days, or no expiry.'
      if (!scopes || expiry === undefined || fields.name)
        return fail(422, 'validation_failed', 'Check the highlighted fields.', fields)
      if (tokens.length >= 20)
        return fail(409, 'too_many_tokens', 'You have 20 API tokens: revoke one first.')
      const secret = `hvt_${Array.from({ length: 26 }, () => BASE32[Math.floor(Math.random() * 32)]).join('')}`
      const listed: ApiToken = {
        id: `tok_${Math.random().toString(36).slice(2, 10)}`,
        name,
        scopes,
        prefix: secret.slice(0, 8),
        workspace: { id: 'wsp_mock', name: 'My workspace' },
        created_at: new Date().toISOString(),
        last_used_at: null,
        expires_at: expiry && new Date(Date.now() + expiry * 24 * 3_600_000).toISOString(),
      }
      tokens = [listed, ...tokens]
      return HttpResponse.json({ data: { ...listed, token: secret } }, { status: 201 })
    },
  ),
  http.delete<{ id: string }>('/api/v1/account/tokens/:id', ({ params }) => {
    if (!tokens.some((token) => token.id === params.id)) return fail(404, 'not_found', 'Not found.')
    tokens = tokens.filter((token) => token.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
]

import { ApiError } from '@/lib/api'
import { translate } from '@/lib/i18n'

import {
  commitSummary,
  defaultSelection,
  expiryText,
  fileErrorText,
  importKindByLabel,
  importProblem,
  importsApi,
  isClean,
  isImportBatch,
  isSettled,
  pollInterval,
  recordChanges,
  resumable,
  applyToAll,
  conflictsOf,
  type CommitResult,
  type ImportBatch,
  type ImportRecord,
} from './imports'

const record = (over: Partial<ImportRecord> = {}): ImportRecord => ({
  id: 'imr_1',
  file_id: 'imf_1',
  kind: 'clients',
  status: 'pending',
  data: { name: 'Muster AG' },
  issues: {},
  duplicate: null,
  entity_id: null,
  error: null,
  ...over,
})

const batch = (over: Partial<ImportBatch> = {}): ImportBatch => ({
  id: 'imp_1',
  kind: 'clients',
  status: 'review',
  created_at: '2026-11-09T10:00:00Z',
  files: [
    {
      id: 'imf_1',
      name: 'clients.csv',
      size: 120,
      content_type: 'text/plain',
      status: 'done',
      error: null,
      chunks_done: 1,
      chunks_total: 1,
      reused: false,
      document_type: null,
    },
  ],
  records: [record()],
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

test('a batch from the contract passes the guard; a broken record does not', () => {
  expect(isImportBatch(batch())).toBe(true)
  expect(
    isImportBatch({ ...batch(), records: [{ ...record(), data: { name: { nested: true } } }] }),
  ).toBe(false)
  expect(isImportBatch({ ...batch(), kind: 'timesheets' })).toBe(false)
  expect(isImportBatch({ ...batch(), files: [{ id: 'imf_1' }] })).toBe(false)
})

test('the upload sends kind and files[] as multipart and refuses a malformed answer', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ data: batch() }, { status: 201 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const file = new File(['name\nMuster AG'], 'clients.csv', { type: 'text/csv' })

  await expect(importsApi.upload('clients', [file])).resolves.toEqual(batch())
  const body = fetchMock.mock.calls[0]?.[1]?.body
  expect(body).toBeInstanceOf(FormData)
  if (!(body instanceof FormData)) return
  expect(body.get('kind')).toBe('clients')
  expect(body.getAll('files[]')).toHaveLength(1)

  fetchMock.mockResolvedValueOnce(Response.json({ data: { id: 'imp_1' } }))
  await expect(importsApi.upload('clients', [file])).rejects.toThrow('cannot read')
})

test('an import from Documents sends the chosen ids as JSON', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ data: batch({ kind: 'auto' }) }, { status: 201 }),
  )
  vi.stubGlobal('fetch', fetchMock)

  await expect(importsApi.fromDocuments(['doc_1', 'doc_2'])).resolves.toEqual(
    batch({ kind: 'auto' }),
  )
  const [url, init] = fetchMock.mock.calls[0] ?? []
  expect(String(url)).toMatch(/\/api\/v1\/imports\/documents$/)
  expect(init?.method).toBe('POST')
  expect(JSON.parse(String(init?.body))).toEqual({ document_ids: ['doc_1', 'doc_2'] })
})

test('the list asks for one entry point: a kind, and the client of a client drawer', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [] }))
  vi.stubGlobal('fetch', fetchMock)

  await importsApi.list('invoices')
  await importsApi.list('invoices', 'cli_1')
  const urls = fetchMock.mock.calls.map(([url]) => String(url))
  expect(urls[0]).toMatch(/\/api\/v1\/imports\?kind=invoices$/)
  expect(urls[1]).toMatch(/\/api\/v1\/imports\?kind=invoices&client_id=cli_1$/)
})

test('polls only while the files are still being read', () => {
  expect(pollInterval(batch({ status: 'extracting' }))).toBe(2000)
  expect(pollInterval(batch())).toBe(false)
  expect(pollInterval(undefined)).toBe(false)
})

test('only clean rows start selected', () => {
  const records = [
    record({ id: 'clean' }),
    record({ id: 'issue', issues: { email: 'Enter a valid email address.' } }),
    record({ id: 'dup', duplicate: { id: 'cli_1', label: 'Muster AG', reason: 'same name' } }),
    record({ id: 'done', status: 'created', entity_id: 'cli_2' }),
  ]
  expect([...defaultSelection(records)]).toEqual(['clean'])
})

test('reopens the newest batch that is still being read or has pending records', () => {
  const base = { kind: 'clients' as const, created_at: '2026-11-09T10:00:00Z' }
  expect(
    resumable([
      { ...base, id: 'done', status: 'review', pending: 0 },
      { ...base, id: 'reading', status: 'extracting', pending: 0 },
      { ...base, id: 'older', status: 'review', pending: 3 },
    ])?.id,
  ).toBe('reading')
  expect(resumable([{ ...base, id: 'done', status: 'review', pending: 0 }])).toBeNull()
})

test('offers only the unfinished batch of the same client scope', () => {
  const base = {
    kind: 'invoices' as const,
    created_at: '2026-11-09T10:00:00Z',
    status: 'review' as const,
  }
  const batches = [
    { ...base, id: 'other', client_id: 'cli_2', pending: 1 },
    { ...base, id: 'mine', client_id: 'cli_1', pending: 1 },
    { ...base, id: 'any', client_id: null, pending: 1 },
  ]
  expect(resumable(batches, 'cli_1')?.id).toBe('mine')
  expect(resumable(batches)?.id).toBe('any')
  expect(resumable(batches.slice(0, 2))).toBeNull()
})

const ok: CommitResult = {
  id: 'a',
  status: 'created',
  entity_id: 'cli_1',
  error: null,
  conflict: null,
}
const bad: CommitResult = {
  id: 'b',
  status: 'failed',
  entity_id: null,
  error: { code: 'limit_reached', message: 'Limit' },
  conflict: null,
}
const taken = (id: string, canOverwrite: boolean): CommitResult => ({
  id,
  status: 'conflict',
  entity_id: null,
  error: null,
  conflict: {
    id: `inv_${id}`,
    label: `ALT-${id} · Kunde AG`,
    reason: 'number already used',
    can_overwrite: canOverwrite,
    why_not: canOverwrite ? null : 'It already has payments recorded.',
  },
})

test('summarises a commit', () => {
  expect(commitSummary([ok, ok, bad])).toBe('2 created, 1 needs attention')
  expect(commitSummary([ok, bad, bad])).toBe('1 created, 2 need attention')
  expect(commitSummary([ok])).toBe('1 created')
  expect(commitSummary([ok, { ...ok, id: 'c', status: 'skipped' }, taken('d', true)])).toBe(
    '1 created, 1 skipped, 1 needs attention',
  )
})

test('picks out the conflicts, and applies one choice to all where it is allowed', () => {
  const conflicts = conflictsOf([ok, taken('1', true), bad, taken('2', false)])
  expect(conflicts.map((entry) => entry.id)).toEqual(['1', '2'])
  expect(applyToAll(conflicts, 'overwrite')).toEqual({ '1': 'overwrite', '2': 'skip' })
  expect(applyToAll(conflicts, 'skip')).toEqual({ '1': 'skip', '2': 'skip' })
})

test('the commit sends the resolutions and reads conflicts; a broken conflict is refused', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ data: { results: [ok, taken('1', false)], batch: batch() } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const answer = await importsApi.commit('imp_1', {
    recordIds: ['a', '1'],
    resolutions: { '1': 'skip' },
  })
  expect(answer.results[1]?.conflict?.why_not).toBe('It already has payments recorded.')
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    record_ids: ['a', '1'],
    resolutions: { '1': 'skip' },
  })

  fetchMock.mockResolvedValueOnce(
    Response.json({
      data: { results: [{ ...taken('1', true), conflict: { id: 'x' } }], batch: batch() },
    }),
  )
  await expect(importsApi.commit('imp_1', { recordIds: ['1'] })).rejects.toThrow('cannot read')
})

test('a settled record is created or skipped', () => {
  expect(
    (['pending', 'created', 'failed', 'skipped'] as const).map((status) =>
      isSettled(record({ status })),
    ),
  ).toEqual([false, true, false, true])
  expect(isClean(record({ status: 'skipped' }))).toBe(false)
})

test('a toggle is sent as a boolean', () => {
  expect(
    recordChanges(
      { issued_elsewhere: false, number: 'A-1' },
      { issued_elsewhere: 'Yes', number: 'A-1', reverse_charge: 'No' },
      ['issued_elsewhere', 'reverse_charge'],
    ),
  ).toEqual({ issued_elsewhere: true, reverse_charge: false })
})

test('a PATCH carries only changed fields, emptied ones as null', () => {
  expect(
    recordChanges(
      { name: 'Muster AG', email: 'bad', city: 'Bern' },
      { name: ' Muster AG ', email: 'info@muster.ch', city: '', country: '' },
    ),
  ).toEqual({ email: 'info@muster.ch', city: null })
})

test('maps Heidi’s options to kinds', () => {
  expect(importKindByLabel('Clients')).toBe('clients')
  expect(importKindByLabel('Products & services')).toBe('products')
  expect(importKindByLabel('Timesheets')).toBeNull()
})

test('explains errors for novices', () => {
  expect(importProblem(new ApiError(403, 'ai_consent_required', 'x')).kind).toBe('consent')
  expect(importProblem(new ApiError(409, 'ai_not_configured', 'x')).kind).toBe('not_configured')
  expect(importProblem(new ApiError(503, 'ai_unavailable', 'Paused.'))).toMatchObject({
    kind: 'not_configured',
    message: 'Paused.',
  })
  expect(importProblem(new ApiError(402, 'limit_reached', 'Storage is full.'))).toMatchObject({
    kind: 'plan',
    message: 'Storage is full.',
  })
  expect(importProblem(new ApiError(400, 'unsupported_file', 'Save it as .xlsx')).kind).toBe('file')
  expect(importProblem(new ApiError(413, 'http_413', 'Request failed (413).')).message).toMatch(
    '25 MB',
  )
  expect(importProblem(new ApiError(500, 'http_500', 'Request failed (500).')).kind).toBe('retry')
})

describe('fileErrorText', () => {
  it('words a known reason in the reader’s language and passes others as sent', () => {
    expect(
      fileErrorText(
        "The AI couldn't read this file, even after a second try. Upload it again to try again.",
      ),
    ).toBe(translate('importAiNoAnswer'))
    expect(fileErrorText('The uploaded file is missing.')).toBe('The uploaded file is missing.')
  })
})

describe('expiryText', () => {
  const now = Date.parse('2026-11-23T12:00:00Z')
  const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString()
  it.each([
    [31.5, 'Expires in 31 h.'],
    [2, 'Expires in 2 h.'],
    [1.99, 'Expires soon.'],
    [-1, 'Expires soon.'],
  ])('%s hours left: %s', (hours, text) => {
    expect(expiryText(at(hours), now)).toBe(text)
  })
})

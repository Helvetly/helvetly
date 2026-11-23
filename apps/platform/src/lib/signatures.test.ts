import { describe, expect, it } from 'vitest'

import {
  addField,
  buildCreateBody,
  checkSigners,
  clampBox,
  deleteField,
  dropSigner,
  minSize,
  moveField,
  resizeField,
  signersWithoutSignature,
  swapSigners,
  remindTargets,
  titleFromName,
  type SignatureRequest,
  type Signer,
  type DraftField,
} from './signatures'

const field = (change: Partial<DraftField> = {}): DraftField => ({
  key: 'a',
  signer: 0,
  kind: 'signature',
  page: 1,
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.05,
  label: null,
  ...change,
})

describe('field placement', () => {
  it('adds a field centred on the point, kept on the page', () => {
    const [centred] = addField([], 'signature', 1, 2, 0.5, 0.5)
    expect(centred).toMatchObject({ signer: 1, page: 2, kind: 'signature' })
    expect((centred?.x ?? 0) + (centred?.w ?? 0) / 2).toBeCloseTo(0.5)
    const [corner] = addField([], 'name', 0, 1, 1, 1)
    expect((corner?.x ?? 0) + (corner?.w ?? 0)).toBeCloseTo(1)
    expect((corner?.y ?? 0) + (corner?.h ?? 0)).toBeCloseTo(1)
  })

  it('moves within the page', () => {
    const [moved] = moveField([field()], 'a', 2, -2)
    expect(moved).toMatchObject({ x: 0.8, y: 0 })
  })

  it('resizes from the bottom-right, never below the minimum or past the edge', () => {
    const [small] = resizeField([field()], 'a', -1, -1)
    expect(small).toMatchObject({ x: 0.1, y: 0.1, ...minSize('signature') })
    const [text] = resizeField([field({ kind: 'text' })], 'a', -1, -1)
    expect(text).toMatchObject(minSize('text'))
    expect(minSize('signature').h).toBeGreaterThan(minSize('text').h)
    const [big] = resizeField([field()], 'a', 5, 5)
    expect(big?.w).toBeCloseTo(0.9)
    expect(big?.h).toBeCloseTo(0.9)
    expect(big).toMatchObject({ x: 0.1, y: 0.1 })
  })

  it('clamps any box into the page', () => {
    expect(clampBox({ page: 1, x: -1, y: 2, w: 3, h: 0 })).toEqual({
      page: 1,
      x: 0,
      y: 1 - minSize().h,
      w: 1,
      h: minSize().h,
    })
  })

  it('deletes by key', () => {
    expect(deleteField([field(), field({ key: 'b' })], 'a').map((f) => f.key)).toEqual(['b'])
  })

  it('keeps fields with their signer when signers are removed or reordered', () => {
    const fields = [
      field({ key: 'a', signer: 0 }),
      field({ key: 'b', signer: 1 }),
      field({ key: 'c', signer: 2 }),
    ]
    expect(dropSigner(fields, 1).map((f) => [f.key, f.signer])).toEqual([
      ['a', 0],
      ['c', 1],
    ])
    expect(swapSigners(fields, 0, 1).map((f) => f.signer)).toEqual([1, 0, 2])
  })

  it('finds signers without a signature field', () => {
    const fields = [field({ signer: 0 }), field({ signer: 1, kind: 'date' })]
    expect(signersWithoutSignature(fields, 3)).toEqual([1, 2])
  })
})

describe('signers', () => {
  it('needs a name and a valid, distinct email each', () => {
    const result = checkSigners([
      { name: 'Anna', email: 'anna@example.com' },
      { name: '', email: 'ANNA@example.com ' },
      { name: 'Ben', email: 'nope' },
    ])
    expect(result.ok).toBe(false)
    expect(result.rows).toEqual([
      { name: '', email: '' },
      { name: 'Enter a name.', email: 'This person is already a signer.' },
      { name: '', email: 'Enter a valid email address.' },
    ])
    expect(checkSigners([]).list).toBe('Add at least one signer.')
    expect(checkSigners([{ name: 'A', email: 'a@b.ch' }]).ok).toBe(true)
  })
})

describe('the create body', () => {
  it('trims, lowercases and keeps 0-based signer indexes; labels only on text fields', () => {
    const body = buildCreateBody({
      documentId: 'doc_1',
      title: '  Offer ',
      message: '  ',
      order: 'sequential',
      expiresInDays: 30,
      signers: [{ name: ' Anna ', email: ' Anna@Example.com' }],
      fields: [field({ label: 'x' }), field({ key: 'b', kind: 'text', label: ' Job title ' })],
    })
    expect(body).toEqual({
      document_id: 'doc_1',
      title: 'Offer',
      message: null,
      signing_order: 'sequential',
      expires_in_days: 30,
      signers: [{ name: 'Anna', email: 'anna@example.com' }],
      fields: [
        { signer: 0, page: 1, kind: 'signature', x: 0.1, y: 0.1, w: 0.2, h: 0.05, label: null },
        { signer: 0, page: 1, kind: 'text', x: 0.1, y: 0.1, w: 0.2, h: 0.05, label: 'Job title' },
      ],
    })
  })

  it('titles from the file name', () => {
    expect(titleFromName('Service agreement.PDF')).toBe('Service agreement')
    // Only the extension goes: the rest of the name is never guessed away.
    expect(titleFromName('Vertrag Vorlage Deutsch V1.0.docx')).toBe('Vertrag Vorlage Deutsch V1.0')
    expect(titleFromName('.pdf')).toBe('.pdf')
  })
})

describe('remindTargets', () => {
  const signer = (position: number, status: Signer['status']): Signer => ({
    id: `sgr_${position}`,
    position,
    name: `Signer ${position}`,
    email: `s${position}@example.ch`,
    status,
    sent_at: null,
    viewed_at: null,
    signed_at: null,
    declined_at: null,
    decline_reason: null,
  })
  const request = (change: Partial<SignatureRequest>): SignatureRequest => ({
    id: 'sig_1',
    title: 'Lease',
    message: null,
    status: 'pending',
    signing_order: 'parallel',
    document: null,
    signed_document: null,
    folder_id: null,
    original_sha256: '',
    final_sha256: null,
    page_count: 1,
    expires_at: '',
    created_by: null,
    created_at: '',
    completed_at: null,
    signers: [],
    fields: [],
    ...change,
  })
  const signers = [signer(2, 'waiting'), signer(1, 'signed'), signer(3, 'viewed')]

  it('names the signer whose turn it is, one after another', () => {
    expect(
      remindTargets(request({ signing_order: 'sequential', signers })).map((s) => s.id),
    ).toEqual(['sgr_2'])
  })
  it('names everyone who has not signed, everyone at once', () => {
    expect(remindTargets(request({ signers })).map((s) => s.id)).toEqual(['sgr_2', 'sgr_3'])
  })
  it('names nobody once the request is no longer out for signature', () => {
    for (const status of ['completed', 'declined', 'revoked', 'expired'] as const)
      expect(remindTargets(request({ status, signers }))).toEqual([])
  })
})

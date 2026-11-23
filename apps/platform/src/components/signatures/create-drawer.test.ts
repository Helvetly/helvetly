import type { DocFile } from '@/lib/documents'
import type { DraftField } from '@/lib/signatures'
import type { Template } from '@/lib/templates'

import { stepProblem, stepsFor, type StepId } from './create-drawer'
import { inkBounds } from './ink'
import { moveSigner } from './signers-step'

vi.mock('./script-fonts', () => ({ SCRIPT_FONTS: [] }))

const pdf = { id: 'doc_1', name: 'a.pdf' } as const satisfies Partial<DocFile>
const document: DocFile = {
  ...pdf,
  folder_id: null,
  folder: null,
  size: 1,
  content_type: 'application/pdf',
  kind: 'pdf',
  sha256: null,
  tags: [],
  ai_filing: null,
  previewable: true,
  links: [],
  retained_until: null,
  uploaded_by: null,
  created_at: '',
  updated_at: '',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
}
const sig = (signer: number, change: Partial<DraftField> = {}): DraftField => ({
  key: `k${signer}`,
  signer,
  kind: 'signature',
  page: 1,
  x: 0,
  y: 0,
  w: 0.1,
  h: 0.1,
  label: null,
  ...change,
})
const base: Parameters<typeof stepProblem>[1] = {
  source: 'pdf',
  document,
  template: null,
  client: null,
  values: {},
  title: 'Offer',
  signers: [
    { name: 'Anna', email: 'anna@example.com' },
    { name: 'Ben', email: 'ben@example.com' },
  ],
  fields: [sig(0), sig(1)],
}

test.each<[StepId, Partial<typeof base>, string | null]>([
  ['document', { document: null }, 'Choose a PDF to send.'],
  ['document', { title: ' ' }, null],
  ['signers', { signers: [] }, 'Add at least one signer.'],
  [
    'signers',
    { signers: [{ name: '', email: 'x@y.ch' }] },
    'Check the signers’ names and email addresses.',
  ],
  ['place', { fields: [sig(0)] }, 'Add a signature field for Ben.'],
  [
    'place',
    { fields: [sig(0), sig(1), sig(1, { kind: 'text' })] },
    'Say what to enter in each text field.',
  ],
  ['place', {}, null],
  ['message', { title: ' ' }, 'Give the request a title.'],
  ['message', {}, null],
  ['review', {}, null],
])('step %s: %o', (step, change, problem) => {
  expect(stepProblem(step, { ...base, ...change })).toBe(problem)
})

test('a template path needs a template and a client, and adds Fill in', () => {
  const template = { signers: [{ label: 'Client', fill: 'client' }] } as unknown as Template
  expect(stepProblem('document', { ...base, source: 'template' })).toBe('Choose a template.')
  expect(stepsFor('pdf', null)).toEqual(['document', 'signers', 'place', 'message', 'review'])
  expect(stepsFor('template', template)).toEqual([
    'document',
    'fill',
    'signers',
    'message',
    'review',
  ])
  expect(stepsFor('template', { ...template, signers: [] })).toContain('place')
})

test('moveSigner moves one row by adjacent swaps', () => {
  expect(moveSigner(['a', 'b', 'c'], 0, 2)).toEqual({
    list: ['b', 'c', 'a'],
    swaps: [
      [0, 1],
      [1, 2],
    ],
  })
  expect(moveSigner(['a', 'b', 'c'], 2, 1).list).toEqual(['a', 'c', 'b'])
})

test('ink bounds find the drawn pixels', () => {
  const data = new Uint8ClampedArray(4 * 4 * 4)
  data[(1 * 4 + 2) * 4 + 3] = 255
  data[(2 * 4 + 1) * 4 + 3] = 255
  expect(inkBounds(data, 4, 4)).toEqual({ x: 1, y: 1, w: 2, h: 2 })
  expect(inkBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
})

import type { DocFile } from '@/lib/documents'
import type { DraftField } from '@/lib/signatures'

import { stepProblem } from './create-drawer'
import { inkBounds } from './ink'

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
const base = {
  document,
  title: 'Offer',
  signers: [
    { name: 'Anna', email: 'anna@example.com' },
    { name: 'Ben', email: 'ben@example.com' },
  ],
  fields: [sig(0), sig(1)],
}

test.each([
  [0, { document: null }, 'Choose a PDF to send.'],
  [0, { title: ' ' }, null],
  [1, { signers: [] }, 'Add at least one signer.'],
  [
    1,
    { signers: [{ name: '', email: 'x@y.ch' }] },
    'Check the signers’ names and email addresses.',
  ],
  [2, { fields: [sig(0)] }, 'Add a signature field for Ben.'],
  [
    2,
    { fields: [sig(0), sig(1), sig(1, { kind: 'text' })] },
    'Say what to enter in each text field.',
  ],
  [2, {}, null],
  [3, { title: ' ' }, 'Give the request a title.'],
  [3, {}, null],
  [4, {}, null],
])('step %i: %o', (step, change, problem) => {
  expect(stepProblem(step, { ...base, ...change })).toBe(problem)
})

test('ink bounds find the drawn pixels', () => {
  const data = new Uint8ClampedArray(4 * 4 * 4)
  data[(1 * 4 + 2) * 4 + 3] = 255
  data[(2 * 4 + 1) * 4 + 3] = 255
  expect(inkBounds(data, 4, 4)).toEqual({ x: 1, y: 1, w: 2, h: 2 })
  expect(inkBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
})

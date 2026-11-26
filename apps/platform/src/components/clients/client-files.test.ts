import type { ClientFile } from '@/lib/clients'
import { documentKinds } from '@/lib/document-tags'

import { fileMeta, groupFiles, previewHref } from './client-files'

const file: ClientFile = {
  id: 'doc 1',
  name: 'Receipt.pdf',
  size: 8_192,
  content_type: 'application/pdf',
  created_at: '2026-11-06T10:00:00Z',
  uploaded_by: { id: 'usr_1', name: 'Anna Muster' },
}

test('the meta line is size, date and uploader', () => {
  expect(fileMeta(file)).toBe('8 KB · 6 Nov 2026 · Anna Muster')
})

test('a gone uploader is left out of the meta line', () => {
  expect(fileMeta({ ...file, uploaded_by: null, size: 2_400_000 })).toBe('2.3 MB · 6 Nov 2026')
})

test('the preview opens the file in Documents', () => {
  expect(previewHref(file)).toBe('/documents?file=doc+1')
})

const tagged = (id: string, ...locked_tags: string[]): ClientFile => ({ ...file, id, locked_tags })
const shape = (files: ClientFile[]) =>
  groupFiles(files).map((group) => [group.label, group.files.map((f) => f.id)])

test('files group by kind in a fixed order, keeping the newest first, with Other last', () => {
  expect(
    shape([
      tagged('inv-2', 'invoice', 'year-2026-11'),
      tagged('loose'),
      tagged('quote', 'quote'),
      tagged('inv-1', 'partial-invoice'),
      tagged('contract', 'contract', 'signed'),
      tagged('signature', 'signed'),
      { ...file, id: 'untagged' },
    ]),
  ).toEqual([
    ['Contracts', ['contract']],
    ['Invoices', ['inv-2', 'inv-1']],
    ['Quotes', ['quote']],
    ['Signed documents', ['signature']],
    ['Other files', ['loose', 'untagged']],
  ])
})

test('files of one kind make a single group', () => {
  expect(shape([tagged('a'), tagged('b', 'year-2026')])).toEqual([['Other files', ['a', 'b']]])
  expect(shape([])).toEqual([])
})

test('every kind tag has a group of its own kind', () => {
  expect(
    documentKinds.filter((kind) => groupFiles([tagged(kind, kind)])[0]?.key === 'clientFilesOther'),
  ).toEqual([])
})

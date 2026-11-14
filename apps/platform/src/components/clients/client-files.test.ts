import type { ClientFile } from '@/lib/clients'

import { fileMeta, previewHref } from './client-files'

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

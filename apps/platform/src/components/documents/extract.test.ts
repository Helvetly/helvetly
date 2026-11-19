import { expect, test } from 'vitest'

import { translate } from '@/lib/i18n'
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_FILES } from '@/lib/imports'

import { extractable, extractBlock } from './extract'

const file = (name: string, content_type = 'application/octet-stream', size = 1000) => ({
  name,
  content_type,
  size,
})

test('reads what the AI import reads, by name or stored type', () => {
  expect(extractable(file('Invoice.PDF'))).toBe(true)
  expect(extractable(file('scan', 'image/jpeg'))).toBe(true)
  expect(extractable(file('list.csv'))).toBe(true)
  expect(extractable(file('old.xls', 'application/vnd.ms-excel'))).toBe(false)
  expect(extractable(file('photo.heic', 'image/heic'))).toBe(false)
})

test.each([
  ['files only', [file('a.pdf'), file('b.png')], 0, null],
  ['a folder in the selection', [file('a.pdf')], 1, translate('extractFoldersBlocked')],
  ['nothing but folders', [], 2, translate('extractFoldersBlocked')],
  ['an unsupported file', [file('a.pdf'), file('b.pages')], 0, translate('extractUnsupported')],
  [
    'too many files',
    Array.from({ length: MAX_IMPORT_FILES + 1 }, (_, i) => file(`${i}.pdf`)),
    0,
    translate('extractTooMany', { max: MAX_IMPORT_FILES }),
  ],
  [
    'a file too large',
    [file('big.pdf', 'application/pdf', MAX_IMPORT_FILE_BYTES + 1)],
    0,
    translate('extractTooLarge'),
  ],
])('%s', (_, files, folders, reason) => {
  expect(extractBlock(files, folders)).toBe(reason)
})

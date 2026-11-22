import { describe, expect, it } from 'vitest'

import {
  childrenOf,
  daysLeft,
  DEFAULT_VIEW,
  filingSummary,
  formatSize,
  freeName,
  isRetained,
  isWithin,
  linkHref,
  listQuery,
  parseView,
  pathTo,
  presetFrom,
  tagCounts,
  trashSortValue,
  uploadDocument,
  viewToQuery,
  withStar,
  type DocFile,
  type Folder,
} from './documents'

const folder = (id: string, parent: string | null, name = id): Folder => ({
  id,
  name,
  parent_id: parent,
  file_count: 0,
  size: 0,
  total_files: 0,
  total_size: 0,
  starred: false,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

const tree = [folder('a', null), folder('b', 'a'), folder('c', 'b'), folder('d', null)]

describe('view state in the URL', () => {
  it('round-trips and leaves defaults out', () => {
    const view = {
      ...DEFAULT_VIEW,
      folder: 'fld_1',
      search: 'offer',
      kinds: ['pdf' as const, 'image' as const],
      mine: true,
      date: '30d' as const,
      sort: 'size' as const,
      desc: true,
      layout: 'list' as const,
      file: 'doc_1',
    }
    const query = viewToQuery(view)
    expect(query.toString()).toBe(
      'folder=fld_1&q=offer&kind=pdf&kind=image&mine=1&date=30d&sort=-size&layout=list&file=doc_1',
    )
    expect(parseView(query)).toEqual(view)
    expect(viewToQuery(DEFAULT_VIEW).toString()).toBe('')
  })

  it('falls back on anything unknown', () => {
    expect(parseView(new URLSearchParams('view=x&sort=-colour&kind=movie&date=1y'))).toEqual(
      DEFAULT_VIEW,
    )
  })

  it('drops the folder outside the files section', () => {
    expect(viewToQuery({ ...DEFAULT_VIEW, section: 'trash', folder: 'x' }).toString()).toBe(
      'view=trash',
    )
  })
})

describe('listQuery', () => {
  it('lists one folder, or everywhere when searching or in Recent', () => {
    expect(listQuery(DEFAULT_VIEW, 'usr_1').get('folder_id')).toBe('root')
    expect(listQuery({ ...DEFAULT_VIEW, folder: 'b' }, 'usr_1').get('folder_id')).toBe('b')
    const search = listQuery({ ...DEFAULT_VIEW, folder: 'b', search: ' offer ' }, 'usr_1')
    expect(search.has('folder_id')).toBe(false)
    expect(search.get('search')).toBe('offer')
    const recent = listQuery({ ...DEFAULT_VIEW, section: 'recent', mine: true }, 'usr_1')
    expect(recent.get('sort')).toBe('-created_at')
    expect(recent.get('uploaded_by')).toBe('usr_1')
  })

  it('turns date presets into a first day', () => {
    const today = '2026-11-05'
    expect(presetFrom('7d', today)).toBe('2026-10-30')
    expect(presetFrom('30d', today)).toBe('2026-10-07')
    expect(presetFrom('year', today)).toBe('2026-01-01')
  })
})

describe('the folder tree', () => {
  it('groups children and walks paths', () => {
    expect(
      childrenOf(tree)
        .get('')
        ?.map((f) => f.id),
    ).toEqual(['a', 'd'])
    expect(pathTo(tree, 'c').map((f) => f.id)).toEqual(['a', 'b', 'c'])
    expect(pathTo(tree, null)).toEqual([])
    expect(isWithin(tree, 'c', 'a')).toBe(true)
    expect(isWithin(tree, 'a', 'c')).toBe(false)
    expect(isWithin(tree, 'd', 'a')).toBe(false)
  })

  it('survives a cycle in corrupt data', () => {
    expect(pathTo([folder('x', 'y'), folder('y', 'x')], 'x')).toHaveLength(2)
  })
})

describe('freeName', () => {
  it.each([
    ['Offer.pdf', [], 'Offer.pdf'],
    ['Offer.pdf', ['offer.PDF'], 'Offer (2).pdf'],
    ['Offer.pdf', ['Offer.pdf', 'Offer (2).pdf'], 'Offer (3).pdf'],
    ['Offer (2).pdf', ['Offer (2).pdf'], 'Offer (3).pdf'],
    ['.env', ['.env'], '.env (2)'],
  ])('%s with %j taken is %s', (name, taken, want) => {
    expect(freeName(name, taken)).toBe(want)
  })
})

describe('formatting', () => {
  it('sizes in decimal units', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1_500)).toBe('1.5 KB')
    expect(formatSize(24_300_000)).toBe('24 MB')
  })

  it('counts down whole days', () => {
    const now = Date.parse('2026-11-05T12:00:00Z')
    expect(daysLeft('2026-11-06T11:00:00Z', now)).toBe(1)
    expect(daysLeft('2026-12-05T12:00:00Z', now)).toBe(30)
    expect(daysLeft('2026-11-01T00:00:00Z', now)).toBe(0)
  })

  it('knows business records and backlinks', () => {
    expect(isRetained('2036-12-31', '2026-11-05')).toBe(true)
    expect(isRetained('2020-12-31', '2026-11-05')).toBe(false)
    expect(isRetained(null)).toBe(false)
    expect(linkHref({ type: 'invoice', id: 'inv_1', label: '', retains: true })).toBe(
      '/invoices?id=inv_1',
    )
  })
})

describe('withStar', () => {
  it('sets the star of one folder only', () => {
    const folders = [folder('a', null), folder('b', null)]
    expect(withStar(folders, 'b', true).map((entry) => entry.starred)).toEqual([false, true])
    expect(
      withStar(withStar(folders, 'b', true), 'b', false).every((entry) => !entry.starred),
    ).toBe(true)
  })
})

describe('uploadDocument', () => {
  it('refuses a file over 25 MB before sending it, with the API’s message', async () => {
    const big = new File(['x'], 'scan.pdf')
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 })
    await expect(uploadDocument(big, { folderId: null }, () => {})).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
      message: 'Upload files of up to 25 MB.',
    })
  })
})

const doc = (id: string, over: Partial<DocFile> = {}): DocFile => ({
  id,
  name: id,
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
  ...over,
})
const filedInto = (name: string | null) => ({
  status: 'filed' as const,
  folder: name ? { id: name, name } : null,
  created_folder: false,
  tags: ['x'],
})

describe('AI filing', () => {
  it('names the one folder a batch went to', () => {
    const summary = filingSummary([
      doc('a', { ai_filing: filedInto('Invoices') }),
      doc('b', { ai_filing: filedInto('Invoices') }),
      doc('c', { ai_filing: { ...filedInto(null), status: 'skipped' } }),
    ])
    expect(summary).toMatchObject({ moved: 2, folders: 1, folder: 'Invoices' })
    expect(summary.filed.map((file) => file.id)).toEqual(['a', 'b'])
  })

  it('counts several folders, and files only tagged', () => {
    expect(
      filingSummary([
        doc('a', { ai_filing: filedInto('Invoices') }),
        doc('b', { ai_filing: filedInto('Contracts') }),
        doc('c', { ai_filing: filedInto(null) }),
      ]),
    ).toMatchObject({ moved: 2, folders: 2, folder: null })
    expect(filingSummary([doc('a')]).filed).toEqual([])
  })

  it('suggests the tags in use, most used first', () => {
    expect(
      tagCounts([doc('a', { tags: ['paid', 'invoice'] }), doc('b', { tags: ['invoice'] })]),
    ).toEqual([
      { name: 'invoice', count: 2 },
      { name: 'paid', count: 1 },
    ])
  })
})

describe('trashSortValue', () => {
  const item = {
    name: 'a.pdf',
    size: 5,
    location: null,
    deleted_at: '2026-01-01',
    purge_at: '2026-01-31',
  }
  it.each([
    ['name', 'a.pdf'],
    ['size', 5],
    ['deleted', '2026-01-01'],
    ['purge', '2026-01-31'],
  ] as const)('%s', (field, expected) => expect(trashSortValue(item, field)).toBe(expected))
  it('names the root when the item was not in a folder', () => {
    expect(trashSortValue(item, 'was')).toBeTruthy()
  })
})

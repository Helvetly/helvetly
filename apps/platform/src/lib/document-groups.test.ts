import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_VIEW,
  groupChange,
  groupLabel,
  groupsQuery,
  listQuery,
  NO_CLIENT,
  openDim,
  parseGrouping,
  parseView,
  storedGrouping,
  storeGrouping,
  viewToQuery,
  zipQuery,
  zipUrl,
} from './documents'

describe('grouped views', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('reads and writes the grouping and its groups in the URL', () => {
    const view = parseView(
      new URLSearchParams('group=type,year&type=invoices&year=2026&client=cli_1'),
    )
    expect(view).toMatchObject({
      group: ['type', 'year'],
      type: 'invoices',
      year: 2026,
      client: 'cli_1',
    })
    expect(viewToQuery(view).toString()).toBe(
      'group=type%2Cyear&type=invoices&year=2026&client=cli_1',
    )
  })

  it('keeps any order of known levels, each once, and only valid groups', () => {
    expect(parseGrouping('client,type')).toEqual(['client', 'type'])
    expect(parseGrouping('year,type')).toEqual(['year', 'type'])
    expect(parseGrouping('client,year,client,kind,type')).toEqual(['client', 'year', 'type'])
    expect(parseGrouping(null)).toEqual([])
    expect(parseView(new URLSearchParams('type=memo&year=26'))).toMatchObject({
      type: null,
      year: null,
    })
  })

  it('opens the first level not chosen yet, then the files', () => {
    const view = { ...DEFAULT_VIEW, group: ['type' as const, 'year' as const] }
    expect(openDim(view)).toBe('type')
    expect(openDim({ ...view, ...groupChange('type', 'quotes') })).toBe('year')
    expect(openDim({ ...view, type: 'quotes', ...groupChange('year', '2025') })).toBeNull()
    expect(groupChange('type', 'memo')).toEqual({ type: null })
  })

  it('lists a group everywhere, with the same filters as its groups and ZIP', () => {
    const view = {
      ...DEFAULT_VIEW,
      folder: 'fld_1',
      group: ['client' as const],
      client: NO_CLIENT,
      search: 'bill',
      mine: true,
    }
    const list = listQuery(view, 'usr_1')
    expect(list.get('folder_id')).toBeNull()
    expect(list.get('client')).toBe(NO_CLIENT)
    expect(list.get('uploaded_by')).toBe('usr_1')
    expect(groupsQuery(view, 'usr_1').toString()).toBe(
      'group=client&search=bill&uploaded_by=usr_1&client=none',
    )
    expect(zipUrl(view, 'usr_1')).toBe(
      '/api/v1/documents/groups/zip?search=bill&uploaded_by=usr_1&client=none&group=client',
    )
    // a folder without groups stays in its folder
    expect(listQuery({ ...DEFAULT_VIEW, folder: 'fld_1' }, 'usr_1').get('folder_id')).toBe('fld_1')
  })

  it('zips what the view shows: chips combined, the grouping, a plain folder', () => {
    const chips = { ...DEFAULT_VIEW, client: 'cli_1', year: 2026, type: 'invoices' as const }
    expect(zipQuery(chips, undefined).toString()).toBe('type=invoices&year=2026&client=cli_1')
    expect(zipQuery({ ...chips, group: ['client', 'year'] }, undefined).toString()).toBe(
      'type=invoices&year=2026&client=cli_1&group=client%2Cyear',
    )
    expect(zipQuery({ ...DEFAULT_VIEW, folder: 'fld_1' }, undefined).toString()).toBe(
      'folder_id=fld_1',
    )
  })

  it('names groups', () => {
    expect(groupLabel('type', { key: 'credit_notes', label: '' })).toBe('Credit notes')
    expect(groupLabel('year', { key: '2026', label: '' })).toBe('2026')
    expect(groupLabel('client', { key: NO_CLIENT, label: '' })).toBe('No client')
    expect(groupLabel('client', { key: 'cli_1', label: 'Acme AG' })).toBe('Acme AG')
    expect(groupLabel('client', { key: 'cli_2', label: '' })).toBe('Deleted client')
  })

  it('remembers the last grouping, and survives storage that is off', () => {
    storeGrouping(['year', 'type'])
    expect(storedGrouping()).toEqual(['year', 'type'])
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(storedGrouping()).toEqual([])
    expect(() => storeGrouping(['type'])).not.toThrow()
  })
})

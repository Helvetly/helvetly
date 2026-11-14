import { describe, expect, it } from 'vitest'

import type { DocFile } from '@/lib/documents'

import { MAX_PARALLEL, newUploads, nextToStart, queueReducer, summarize } from './upload-queue'

const file = (name: string, size: number) => new File(['x'.repeat(size)], name)

const uploaded: DocFile = {
  id: 'doc_1',
  name: '1.pdf',
  folder_id: null,
  folder: null,
  size: 10,
  content_type: 'application/pdf',
  kind: 'pdf',
  sha256: null,
  previewable: true,
  links: [],
  retained_until: null,
  uploaded_by: null,
  created_at: '2026-11-05T10:00:00Z',
  updated_at: '2026-11-05T10:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
}

describe('the upload queue', () => {
  it('runs at most a few at a time, oldest first', () => {
    let state = queueReducer([], {
      type: 'add',
      uploads: newUploads(
        [1, 2, 3, 4, 5].map((n) => file(`${n}.pdf`, 10)),
        null,
        'Documents',
      ),
    })
    expect(nextToStart(state)).toHaveLength(MAX_PARALLEL)
    for (const upload of nextToStart(state))
      state = queueReducer(state, { type: 'start', id: upload.id })
    expect(nextToStart(state)).toHaveLength(0)
    const first = state[0]?.id ?? ''
    state = queueReducer(state, { type: 'done', id: first, result: uploaded })
    expect(nextToStart(state).map((u) => u.file.name)).toEqual(['4.pdf'])
  })

  it('tracks progress by bytes and sums up the outcome', () => {
    let state = queueReducer([], {
      type: 'add',
      uploads: newUploads([file('a.pdf', 300), file('b.pdf', 100), file('c.pdf', 100)], 'f', 'F'),
    })
    const [a, b, c] = state.map((u) => u.id)
    state = queueReducer(state, { type: 'start', id: a ?? '' })
    state = queueReducer(state, { type: 'progress', id: a ?? '', progress: 0.5 })
    state = queueReducer(state, { type: 'failed', id: b ?? '', error: 'Not a supported file' })
    state = queueReducer(state, { type: 'cancel', id: c ?? '' })
    expect(summarize(state)).toEqual({
      total: 2,
      done: 0,
      failed: 1,
      conflicts: 0,
      active: 1,
      progress: 150 / 400,
    })
    // Cancelling something finished changes nothing; clear keeps what still runs.
    state = queueReducer(state, { type: 'cancel', id: b ?? '' })
    expect(state[1]?.status).toBe('failed')
    expect(queueReducer(state, { type: 'clear' }).map((u) => u.id)).toEqual([a])
  })

  it('resolves name clashes one by one or all at once', () => {
    let state = queueReducer([], {
      type: 'add',
      uploads: newUploads([file('a.pdf', 1), file('b.pdf', 1), file('c.pdf', 1)], null, 'D'),
    })
    const [a, b, c] = state.map((u) => u.id)
    for (const id of [a, b, c])
      state = queueReducer(state, { type: 'conflict', id: id ?? '', suggestion: 'x (2).pdf' })
    expect(summarize(state).conflicts).toBe(3)
    state = queueReducer(state, { type: 'retry', id: a ?? '', onConflict: 'replace' })
    expect(state[0]).toMatchObject({ status: 'queued', onConflict: 'replace' })
    state = queueReducer(state, { type: 'resolveAll', onConflict: 'keep_both' })
    expect(state.map((u) => [u.status, u.onConflict])).toEqual([
      ['queued', 'replace'],
      ['queued', 'keep_both'],
      ['queued', 'keep_both'],
    ])
    state = queueReducer(state, { type: 'conflict', id: c ?? '', suggestion: '' })
    state = queueReducer(state, { type: 'resolveAll', onConflict: 'skip' })
    expect(state[2]?.status).toBe('cancelled')
  })
})

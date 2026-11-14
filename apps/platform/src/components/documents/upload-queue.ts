import type { DocFile, OnConflict } from '@/lib/documents'

/** One file in the upload tray, from waiting to done (or not). */
export type Upload = {
  id: string
  file: File
  folderId: string | null
  folderName: string
  status: 'queued' | 'uploading' | 'done' | 'failed' | 'conflict' | 'cancelled'
  progress: number // 0–1
  onConflict: OnConflict
  error: string | null
  suggestion: string | null // the "keep both" name the server offered on a clash
  result: DocFile | null
}

export type QueueAction =
  | { type: 'add'; uploads: Upload[] }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'done'; id: string; result: DocFile }
  | { type: 'failed'; id: string; error: string }
  | { type: 'conflict'; id: string; suggestion: string }
  | { type: 'cancel'; id: string }
  | { type: 'retry'; id: string; onConflict?: OnConflict }
  | { type: 'resolveAll'; onConflict: OnConflict | 'skip' }
  | { type: 'clear' }

export const MAX_PARALLEL = 3

const settled = (status: Upload['status']) =>
  status === 'done' || status === 'failed' || status === 'cancelled'

export function queueReducer(state: Upload[], action: QueueAction): Upload[] {
  const patch = (id: string, change: Partial<Upload>) =>
    state.map((upload) => (upload.id === id ? { ...upload, ...change } : upload))
  switch (action.type) {
    case 'add':
      return [...state, ...action.uploads]
    case 'start':
      return patch(action.id, { status: 'uploading', progress: 0, error: null })
    case 'progress':
      return patch(action.id, { progress: action.progress })
    case 'done':
      return patch(action.id, { status: 'done', progress: 1, result: action.result })
    case 'failed':
      return patch(action.id, { status: 'failed', error: action.error })
    case 'conflict':
      return patch(action.id, { status: 'conflict', suggestion: action.suggestion })
    case 'cancel':
      return state.map((upload) =>
        upload.id === action.id && !settled(upload.status)
          ? { ...upload, status: 'cancelled' }
          : upload,
      )
    case 'retry':
      return patch(action.id, {
        status: 'queued',
        progress: 0,
        error: null,
        ...(action.onConflict && { onConflict: action.onConflict }),
      })
    case 'resolveAll':
      return state.map((upload) =>
        upload.status !== 'conflict'
          ? upload
          : action.onConflict === 'skip'
            ? { ...upload, status: 'cancelled' }
            : { ...upload, status: 'queued', progress: 0, onConflict: action.onConflict },
      )
    case 'clear':
      return state.filter((upload) => !settled(upload.status))
  }
}

/** The uploads to start now: queued ones, oldest first, while fewer than MAX_PARALLEL run. */
export function nextToStart(state: Upload[]) {
  const running = state.filter((upload) => upload.status === 'uploading').length
  return state
    .filter((upload) => upload.status === 'queued')
    .slice(0, Math.max(0, MAX_PARALLEL - running))
}

export type QueueSummary = {
  total: number
  done: number
  failed: number
  conflicts: number
  active: number
  /** Share of all bytes sent so far, over the uploads that are not cancelled. */
  progress: number
}

export function summarize(state: Upload[]): QueueSummary {
  const live = state.filter((upload) => upload.status !== 'cancelled')
  const bytes = live.reduce((sum, upload) => sum + upload.file.size, 0)
  const sent = live.reduce((sum, upload) => sum + upload.file.size * upload.progress, 0)
  const count = (status: Upload['status']) => state.filter((u) => u.status === status).length
  return {
    total: live.length,
    done: count('done'),
    failed: count('failed'),
    conflicts: count('conflict'),
    active: count('queued') + count('uploading'),
    progress: bytes > 0 ? sent / bytes : live.length > 0 && count('done') === live.length ? 1 : 0,
  }
}

let counter = 0

export function newUploads(
  files: File[],
  folderId: string | null,
  folderName: string,
  onConflict: OnConflict = 'fail',
): Upload[] {
  return files.map((file) => ({
    id: `up${++counter}`,
    file,
    folderId,
    folderName,
    status: 'queued',
    progress: 0,
    onConflict,
    error: null,
    suggestion: null,
    result: null,
  }))
}

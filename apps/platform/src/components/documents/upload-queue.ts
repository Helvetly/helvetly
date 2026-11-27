import type { DocFile, OnConflict, StagedFile } from '@/lib/documents'

/** One file in the upload tray, from waiting to done (or not). */
export type Upload = {
  id: string
  file: File
  folderId: string | null
  folderName: string
  /** The staging batch it is uploaded into (Upload with AI smart grouping on); null: straight into the folder. */
  batchId: string | null
  status:
    | 'queued'
    | 'uploading'
    | 'staged' // in the staging area, waiting for "Just upload" or the AI's grouping
    | 'duplicate' // the bytes are already in Documents: not staged
    | 'done'
    | 'reused'
    | 'failed'
    | 'conflict'
    | 'cancelled'
  progress: number // 0–1
  onConflict: OnConflict
  error: string | null
  suggestion: string | null // the "keep both" name the server offered on a clash
  result: DocFile | null
  staged: StagedFile | null
}

export type QueueAction =
  | { type: 'add'; uploads: Upload[] }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'done'; id: string; result: DocFile; reused?: boolean }
  | { type: 'failed'; id: string; error: string }
  | { type: 'conflict'; id: string; suggestion: string }
  | { type: 'cancel'; id: string }
  | { type: 'retry'; id: string; onConflict?: OnConflict }
  | { type: 'resolveAll'; onConflict: OnConflict | 'skip' }
  | { type: 'staged'; id: string; staged: StagedFile }
  | { type: 'duplicate'; id: string; error: string }
  /** The batch was filed: each staged file's Document and the folder it went to; the rest were duplicates. */
  | {
      type: 'filed'
      batchId: string
      filed: Record<string, { result: DocFile; folderName: string }>
    }
  | { type: 'discard'; batchId: string }
  | { type: 'clear' }

export const MAX_PARALLEL = 3

const settled = (status: Upload['status']) =>
  status === 'done' ||
  status === 'reused' ||
  status === 'duplicate' ||
  status === 'failed' ||
  status === 'cancelled'

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
      return patch(action.id, {
        status: action.reused ? 'reused' : 'done',
        progress: 1,
        result: action.result,
      })
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
    case 'staged':
      return patch(action.id, { status: 'staged', progress: 1, staged: action.staged })
    case 'duplicate':
      return patch(action.id, { status: 'duplicate', error: action.error })
    case 'filed':
      return state.map((upload) => {
        if (upload.batchId !== action.batchId || upload.status !== 'staged') return upload
        const filed = upload.staged && action.filed[upload.staged.id]
        return filed
          ? { ...upload, status: 'done', result: filed.result, folderName: filed.folderName }
          : { ...upload, status: 'reused' }
      })
    case 'discard':
      return state.map((upload) =>
        upload.batchId === action.batchId && !settled(upload.status)
          ? { ...upload, status: 'cancelled' }
          : upload,
      )
    case 'clear':
      return state.filter((upload) => !settled(upload.status))
  }
}

/** The batch whose files are all uploaded (some staged) and wait for the person's choice; null when none. */
export function readyBatch(state: Upload[]) {
  const batches = new Set(state.flatMap((upload) => (upload.batchId ? [upload.batchId] : [])))
  for (const batchId of batches) {
    const files = state.filter((upload) => upload.batchId === batchId)
    const [first] = files
    if (
      first &&
      files.some((upload) => upload.status === 'staged') &&
      !files.some((upload) => upload.status === 'queued' || upload.status === 'uploading')
    )
      return { batchId, folderId: first.folderId, folderName: first.folderName, files }
  }
  return null
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
  /** Files whose bytes were already in Documents: nothing new stored, not a failure. */
  reused: number
  failed: number
  conflicts: number
  /** Uploaded into the staging area, waiting for the person's choice. */
  staged: number
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
    reused: count('reused'),
    failed: count('failed'),
    conflicts: count('conflict'),
    staged: count('staged'),
    active: count('queued') + count('uploading'),
    progress:
      bytes > 0
        ? sent / bytes
        : live.length > 0 && count('done') + count('reused') + count('staged') === live.length
          ? 1
          : 0,
  }
}

let counter = 0

export function newUploads(
  files: File[],
  folderId: string | null,
  folderName: string,
  onConflict: OnConflict = 'fail',
  batchId: string | null = null,
): Upload[] {
  return files.map((file) => ({
    id: `up${++counter}`,
    file,
    folderId,
    folderName,
    batchId,
    status: 'queued',
    progress: 0,
    onConflict,
    error: null,
    suggestion: null,
    result: null,
    staged: null,
  }))
}

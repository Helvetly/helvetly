import { ApiError, errorFromBody, getCsrfToken } from '@/lib/api'
import { translate } from '@/lib/i18n'

/** Cloudflare refuses request bodies over 100 MB, so one request carries at most 95 MB of files. */
export const MAX_REQUEST_BYTES = 95 * 1024 * 1024

/** The largest file any upload takes, as the API enforces it. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024

const MB = 1024 * 1024

/** The files in request-sized packs, in their order; a pack's sizes add up to at most `limit`. */
export function packFiles(files: File[], limit = MAX_REQUEST_BYTES): File[][] {
  const packs: File[][] = []
  let pack: File[] = []
  let size = 0
  for (const file of files) {
    if (pack.length && size + file.size > limit) {
      packs.push(pack)
      pack = []
      size = 0
    }
    pack.push(file)
    size += file.size
  }
  if (pack.length) packs.push(pack)
  return packs
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The files without later copies of the same bytes (a renamed copy counts): one upload is enough, so the second is
 * dropped silently. Only files that share a size can be identical, so only those are hashed.
 */
export async function dropSameBytes(files: File[]): Promise<File[]> {
  const sizes = new Map<number, number>()
  for (const file of files) sizes.set(file.size, (sizes.get(file.size) ?? 0) + 1)
  const sums = await Promise.all(
    files.map(async (file) => ((sizes.get(file.size) ?? 0) > 1 ? await sha256(file) : null)),
  )
  const seen = new Set<string>()
  return files.filter((_, index) => {
    const sum = sums[index]
    if (sum === null || sum === undefined) return true
    if (seen.has(sum)) return false
    seen.add(sum)
    return true
  })
}

/** One multipart request of files[]; rejects with the server's reason in details.fields.files when it gives one. */
function postFiles<T>(
  url: string,
  files: File[],
  onProgress: (share: number) => void,
): Promise<T[]> {
  const form = new FormData()
  for (const file of files) form.append('files[]', file)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader(translate('accept'), 'application/json')
    const token = getCsrfToken()
    if (token) xhr.setRequestHeader('X-CSRF-Token', token)
    xhr.responseType = 'json'
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    })
    xhr.addEventListener('load', () => {
      const body: unknown = xhr.response
      if (xhr.status >= 200 && xhr.status < 300) {
        const data =
          typeof body === 'object' && body !== null && 'data' in body ? body.data : undefined
        resolve(Array.isArray(data) ? data : [])
        return
      }
      const error = errorFromBody(xhr.status, body)
      const fields = error.details.fields
      const reason =
        typeof fields === 'object' && fields !== null && 'files' in fields ? fields.files : null
      reject(typeof reason === 'string' ? new ApiError(error.status, error.code, reason) : error)
    })
    xhr.addEventListener('error', () =>
      reject(new ApiError(0, 'network_error', translate('cannotReachHelvetlyCheckYourConnection'))),
    )
    xhr.send(form)
  })
}

/**
 * Uploads files to a files[] endpoint in packs of at most 95 MB, one after another, with one progress (0–1) over
 * all bytes. A file over the size limit refuses the batch before the first request; identical files in it are sent once.
 */
export async function uploadInPacks<T>(
  url: string,
  files: File[],
  maxFileBytes: number,
  onProgress: (share: number) => void,
): Promise<T[]> {
  const big = files.find((file) => file.size > maxFileBytes)
  if (big)
    throw new ApiError(
      422,
      'validation_failed',
      translate('isLargerThanMB', { name: big.name, value2: maxFileBytes / MB }),
    )
  const unique = await dropSameBytes(files)
  const packs = packFiles(unique)
  const total = unique.reduce((sum, file) => sum + file.size, 0)
  // One pack at a time: the next request starts only once the server has taken the one before.
  const sendFrom = async (index: number, sent: number): Promise<T[]> => {
    const pack = packs[index]
    if (!pack) return []
    const bytes = pack.reduce((sum, file) => sum + file.size, 0)
    const added = await postFiles<T>(url, pack, (share) =>
      onProgress(total > 0 ? (sent + share * bytes) / total : share),
    )
    return [...added, ...(await sendFrom(index + 1, sent + bytes))]
  }
  return sendFrom(0, 0)
}

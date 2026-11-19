import type { DocFile } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { IMPORT_ACCEPT, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_FILES } from '@/lib/imports'

const EXTENSIONS = IMPORT_ACCEPT.split(',')
const TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
])

/** A file the AI import reads, going by its name or stored type; the API decides from the bytes. */
export const extractable = (file: Pick<DocFile, 'name' | 'content_type'>) =>
  EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)) ||
  TYPES.has(file.content_type.split(';')[0]?.trim().toLowerCase() ?? '')

/** Why "Extract with AI" cannot read this selection, or null when it can. */
export function extractBlock(
  files: Pick<DocFile, 'name' | 'content_type' | 'size'>[],
  folders: number,
): string | null {
  if (folders > 0 || files.length === 0) return translate('extractFoldersBlocked')
  if (files.length > MAX_IMPORT_FILES) return translate('extractTooMany', { max: MAX_IMPORT_FILES })
  if (!files.every(extractable)) return translate('extractUnsupported')
  if (files.some((file) => file.size > MAX_IMPORT_FILE_BYTES)) return translate('extractTooLarge')
  return null
}

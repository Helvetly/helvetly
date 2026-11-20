import type { Folder, FolderRef, SystemKind } from '@/lib/documents'
import { translate } from '@/lib/i18n'

type Translate = (key: SystemLabelKey) => string
type SystemLabelKey =
  | 'clients'
  | 'expenses'
  | 'invoices'
  | 'quotes'
  | 'engagements'
  | 'signatures'
  | 'documents'

// Kinds whose stored name is the English canonical one; "client" and "year" show their own name.
const LABEL_KEYS: Partial<Record<SystemKind, SystemLabelKey>> = {
  clients: 'clients',
  expenses: 'expenses',
  invoices: 'invoices',
  quotes: 'quotes',
  engagements: 'engagements',
  signatures: 'signatures',
  documents: 'documents',
}

const RECORD_KEYS: Record<string, SystemLabelKey> = {
  Invoices: 'invoices',
  Quotes: 'quotes',
  Engagements: 'engagements',
  Signatures: 'signatures',
  Documents: 'documents',
}

export const isSystemFolder = (folder: { system_kind?: SystemKind | null } | null | undefined) =>
  Boolean(folder?.system_kind)

/** A folder's name as shown: typed system folders in the user's language, everything else as stored. */
export function folderLabel(
  folder: Pick<Folder | FolderRef, 'name' | 'system_kind'>,
  t: Translate = translate,
) {
  const key = folder.system_kind ? LABEL_KEYS[folder.system_kind] : undefined
  return key ? t(key) : folder.name
}

/** A canonical "/"-joined path (organize proposals) with its system segments translated. */
export function pathLabel(path: string, t: Translate = translate) {
  const parts = path.split('/')
  const root = parts[0] === 'Clients' ? 'clients' : parts[0] === 'Expenses' ? 'expenses' : null
  if (!root) return path
  const shown = [...parts]
  shown[0] = t(root)
  const record = root === 'clients' ? RECORD_KEYS[parts[2] ?? ''] : undefined
  if (record) shown[2] = t(record)
  return shown.join('/')
}

const HIDEABLE = new Set<SystemKind>([
  'client',
  'invoices',
  'quotes',
  'engagements',
  'signatures',
  'documents',
  'year',
])

/**
 * The folders without the system sub-folders that hold nothing (no files, no folder a person made);
 * the roots Clients and Expenses and anything in `keep` (the open folder and its path) always stay.
 */
export function withoutEmptySystem(folders: Folder[], keep: ReadonlySet<string> = new Set()) {
  const children = new Map<string, Folder[]>()
  for (const folder of folders)
    if (folder.parent_id)
      children.set(folder.parent_id, [...(children.get(folder.parent_id) ?? []), folder])
  const visible = (folder: Folder): boolean => {
    if (
      !folder.system_kind ||
      !HIDEABLE.has(folder.system_kind) ||
      folder.total_files > 0 ||
      keep.has(folder.id)
    )
      return true
    return (children.get(folder.id) ?? []).some(visible)
  }
  return folders.filter(visible)
}

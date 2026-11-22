'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Combobox, type Option } from '@helvetly/ui/components/combobox'
import { useMemo } from 'react'

import type { Folder } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { pathLabel } from '@/lib/system-folders'

import { SystemMark } from './system-mark'

/** Canonical "/"-joined path of every folder, with the folder itself. */
export function folderEntries(folders: Folder[]): { path: string; folder: Folder }[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const pathOf = (folder: Folder): string => {
    const parent = folder.parent_id ? byId.get(folder.parent_id) : undefined
    return parent ? `${pathOf(parent)}/${folder.name}` : folder.name
  }
  return folders.map((folder) => ({ path: pathOf(folder), folder }))
}

const clean = (path: string) => path.trim().replace(/^\/+|\/+$/g, '')
const shown = (path: string) => pathLabel(path).split('/').join(' › ')

/**
 * Why a path cannot be filed into, or null: system folders (a client's, a category's, a year's) are made by
 * Helvetly only, so a new path under Clients or Expenses must start below the year or category folders.
 * The API enforces the same rule by leaving the document where it is.
 */
export function folderProblem(path: string, existing: ReadonlySet<string>): string | null {
  const parts = clean(path).split('/').filter(Boolean)
  const root = parts[0]?.toLowerCase()
  if (root !== 'clients' && root !== 'expenses') return null
  let known = 0
  while (
    known < parts.length &&
    existing.has(
      parts
        .slice(0, known + 1)
        .join('/')
        .toLowerCase(),
    )
  )
    known++
  if (known === parts.length) return null
  return known >= (root === 'clients' ? 4 : 3) ? null : translate('organizeSystemOnly')
}

/** Picks one of the workspace's folders, or types a path for a new one (made when the changes are applied). */
export function FolderCombobox({
  folders,
  value,
  onChange,
  label,
  invalid,
}: {
  folders: Folder[]
  /** The canonical path; '' is the top level. */
  value: string
  onChange: (path: string) => void
  label: string
  invalid?: boolean
}) {
  const options = useMemo(() => {
    const entries = folderEntries(folders).toSorted((a, b) => a.path.localeCompare(b.path))
    const list: Option[] = [
      { value: '', label: translate('organizeTopLevel') },
      ...entries.map(({ path, folder }) => ({
        value: path,
        label: shown(path),
        adornment: folder.system_kind ? <SystemMark /> : undefined,
      })),
    ]
    const target = clean(value)
    if (target && !entries.some((entry) => entry.path.toLowerCase() === target.toLowerCase()))
      list.push({
        value: target,
        label: shown(target),
        hint: translate('organizeNewFolder'),
      })
    return list
  }, [folders, value])
  const current = clean(value)
  const match = options.find((option) => option.value.toLowerCase() === current.toLowerCase())
  return (
    <Combobox
      label={label}
      value={match?.value ?? ''}
      options={options}
      placeholder={translate('organizeTopLevel')}
      invalid={invalid}
      searchable
      renderValue={(option) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{option.label}</span>
          {option.hint && (
            <Badge tone="violet" size="sm">
              {option.hint}
            </Badge>
          )}
        </span>
      )}
      createLabel={translate('organizeNewFolder')}
      onChange={onChange}
      onCreate={(term) => term && onChange(clean(term.split('›').join('/')))}
      contentClassName="min-w-80"
    />
  )
}

'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import { fieldSurface } from '@helvetly/ui/lib/field-surface'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronRight, X } from 'lucide-react'

import type { Folder } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { pathLabel } from '@/lib/system-folders'

import { SystemMark } from './system-mark'

/** Canonical "/"-joined path of every folder, with the folder itself. */
export function folderEntries<T extends Pick<Folder, 'id' | 'name' | 'parent_id'>>(folders: T[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const pathOf = (folder: T): string => {
    const parent = folder.parent_id ? byId.get(folder.parent_id) : undefined
    return parent ? `${pathOf(parent)}/${folder.name}` : folder.name
  }
  return folders.map((folder) => ({ path: pathOf(folder), folder }))
}

const clean = (path: string) => path.trim().replace(/^\/+|\/+$/g, '')

const isYear = (part: string | undefined) => /^(19\d{2}|20\d{2}|21\d{2}|2200)$/.test(part ?? '')

/** New managed destinations are limited to paths that the API can resolve to system folders. */
export function folderProblem(path: string, existing: ReadonlySet<string>): string | null {
  const parts = clean(path).split('/').filter(Boolean)
  const root = parts[0]?.toLowerCase()
  if (root !== 'clients' && root !== 'expenses') return null
  if (existing.has(parts.join('/').toLowerCase())) return null
  const kind = parts[2]?.toLowerCase()
  if (root === 'clients' && isYear(parts[3])) {
    if (
      parts.length === 4 &&
      ['documents', 'invoices', 'quotes', 'engagements', 'signatures'].some((name) => name === kind)
    )
      return null
    if (parts.length === 5 && kind === 'documents' && parts[4]?.toLowerCase() === 'contracts')
      return null
  }
  if (root === 'expenses' && parts.length === 3 && isYear(parts[1])) return null
  return translate('organizeSystemOnly')
}

/** Picks one of the workspace's folders, or types a path for a new one (made when the changes are applied). */
export function FolderPathInput({
  entries,
  value,
  label,
  invalid,
  onChange,
}: {
  entries: ReturnType<typeof folderEntries<Folder>>
  value: string
  label: string
  invalid: boolean
  onChange: (path: string) => void
}) {
  const parts = clean(value).split('/').filter(Boolean)
  const labels = pathLabel(parts.join('/')).split('/')
  const isNew =
    parts.length > 0 &&
    !entries.some(({ path }) => path.toLowerCase() === parts.join('/').toLowerCase())
  const optionsAt = (index: number) => {
    const parent = parts.slice(0, index).join('/').toLowerCase()
    return entries.flatMap(({ path, folder }) => {
      const folderParent = path.slice(0, Math.max(0, path.lastIndexOf('/'))).toLowerCase()
      if (folderParent !== parent) return []
      return [
        {
          value: path,
          label: pathLabel(path).split('/').at(-1) ?? folder.name,
          adornment: folder.system_kind ? <SystemMark /> : undefined,
        },
      ]
    })
  }
  const createAt = (index: number, term: string) => {
    const suffix = term
      .split(/[/›]/)
      .map((part) => part.trim())
      .filter(Boolean)
    if (suffix.length > 0) onChange([...parts.slice(0, index), ...suffix].join('/'))
  }

  return (
    <fieldset
      aria-label={label}
      data-field-surface
      className={cn(fieldSurface, 'flex min-h-9 min-w-0 flex-wrap items-center gap-1 px-1 py-0.5')}
    >
      {parts.map((part, index) => {
        const path = parts.slice(0, index + 1).join('/')
        const shown = labels[index] ?? part
        const options = optionsAt(index)
        if (!options.some((option) => option.value.toLowerCase() === path.toLowerCase())) {
          options.push({ value: path, label: shown, adornment: undefined })
        }
        return (
          <div key={path} className="flex max-w-full min-w-0 items-center gap-1">
            {index > 0 && (
              <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            )}
            <div className="flex min-w-0 items-center rounded-md bg-muted">
              <Combobox
                label={translate('organizeChangeFolderSegment', { name: shown })}
                value={
                  options.find((option) => option.value.toLowerCase() === path.toLowerCase())
                    ?.value ?? path
                }
                options={options}
                placeholder={shown}
                className="h-7 w-auto max-w-48 border-0 bg-transparent pr-1 shadow-none"
                onChange={(next) => {
                  if (next.toLowerCase() !== path.toLowerCase()) onChange(next)
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0 text-muted-foreground"
                aria-label={translate('organizeRemoveFolderSegment', { name: shown })}
                onClick={() => onChange(parts.slice(0, index).join('/'))}
              >
                <X />
              </Button>
            </div>
          </div>
        )
      })}
      {isNew && (
        <Badge size="sm" tone="violet">
          {translate('organizeNewFolder')}
        </Badge>
      )}
      <Combobox
        invalid={invalid}
        label={translate('organizeAddFolderSegment')}
        value=""
        options={optionsAt(parts.length)}
        placeholder={
          parts.length ? translate('organizeAddFolderSegment') : translate('organizeTopLevel')
        }
        className="h-7 w-auto max-w-full border-0 bg-transparent shadow-none"
        onChange={onChange}
        createLabel={translate('organizeNewFolder')}
        onCreate={(term) => createAt(parts.length, term)}
      />
    </fieldset>
  )
}

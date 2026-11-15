'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { Input } from '@helvetly/ui/components/input'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronRight, HardDrive } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

import { childrenOf, isWithin, pathTo, type Folder } from '@/lib/documents'
import { translate } from '@/lib/i18n'

import { FolderMark } from './folder-art'
import { TreeGuide } from './folder-tree'

/** "New folder": a name, checked on the server (which answers a clash with a suggestion). */
export function NewFolderDialog({
  parentName,
  onCreate,
  onClose,
}: {
  parentName: string
  /** Resolves with an error message to show, or null when created. */
  onCreate: (name: string) => Promise<string | null>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    const problem = await onCreate(name.trim())
    setBusy(false)
    if (problem) setError(problem)
    else onClose()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-[400px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          field.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{translate('newFolder')}</DialogTitle>
          <DialogDescription>
            {translate('in2')}
            {parentName}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Input
            ref={field}
            aria-label={translate('folderName')}
            aria-invalid={error ? true : undefined}
            placeholder={translate('eGContracts2026')}
            value={name}
            maxLength={255}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
          />
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <DialogFooter className="mt-3">
            <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
              {translate('cancel')}
            </Button>
            <Button type="submit" className="cursor-pointer" disabled={!name.trim() || busy}>
              {translate('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Picks a destination folder for "Move to…" and "Copy to…": the tree, with forbidden places off. */
export function FolderPickerDialog({
  title,
  action,
  folders,
  initial,
  moving,
  onPick,
  onClose,
}: {
  title: string
  action: string
  folders: Folder[]
  initial: string | null
  /** Folders being moved: neither they nor anything inside them can be the destination. */
  moving: string[]
  onPick: (folder: string | null) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<string | null>(initial)
  const tree = childrenOf(folders)
  const [open, setOpen] = useState<ReadonlySet<string>>(
    new Set(pathTo(folders, initial).map((folder) => folder.id)),
  )
  const blocked = (id: string) => moving.some((ancestor) => isWithin(folders, id, ancestor))

  const branch = (parent: string, depth: number): ReactNode =>
    (tree.get(parent) ?? []).map((folder, index, siblings) => {
      const expanded = open.has(folder.id)
      const off = blocked(folder.id)
      return (
        <div key={folder.id} className="relative">
          <TreeGuide x={PAD + 8 + (depth - 1) * INDENT} last={index === siblings.length - 1} />
          <Row
            depth={depth}
            selected={picked === folder.id}
            disabled={off}
            onClick={() => setPicked(folder.id)}
            toggle={
              tree.has(folder.id)
                ? {
                    expanded,
                    onToggle: () => {
                      const next = new Set(open)
                      if (!next.delete(folder.id)) next.add(folder.id)
                      setOpen(next)
                    },
                  }
                : undefined
            }
          >
            <FolderMark className="size-4" />
            <span className="truncate">{folder.name}</span>
          </Row>
          {expanded && branch(folder.id, depth + 1)}
        </div>
      )
    })

  const where = picked ? (pathTo(folders, picked).at(-1)?.name ?? '') : translate('allDocuments')
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{translate('chooseAFolder')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[340px] overflow-y-auto rounded-lg border p-1.5">
          <Row depth={0} selected={picked === null} onClick={() => setPicked(null)}>
            <HardDrive className="size-4 shrink-0 stroke-[1.5]" />
            <span className="truncate">{translate('allDocuments')}</span>
          </Row>
          {branch('', 1)}
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose}>
            {translate('cancel')}
          </Button>
          <Button className="cursor-pointer" onClick={() => onPick(picked)}>
            {action}
            {translate('to2')}
            {where}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const PAD = 6
const INDENT = 20

function Row({
  depth,
  selected,
  disabled,
  onClick,
  toggle,
  children,
}: {
  depth: number
  selected: boolean
  disabled?: boolean
  onClick: () => void
  toggle?: { expanded: boolean; onToggle: () => void }
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md pr-2 text-[13.5px]',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted',
        disabled && 'pointer-events-none opacity-40',
      )}
      style={{ paddingLeft: PAD + depth * INDENT }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        {children}
      </button>
      {toggle && (
        <button
          type="button"
          aria-label={toggle.expanded ? translate('collapse') : translate('expand')}
          onClick={toggle.onToggle}
          className="-mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-foreground/[0.06]"
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform', toggle.expanded && 'rotate-90')}
          />
        </button>
      )}
    </div>
  )
}

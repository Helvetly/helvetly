import { isWithin, type Folder } from '@/lib/documents'

/** Items on screen are folders, then files; keys keep their ids apart. */
export type ItemKey = `folder:${string}` | `file:${string}`

export const folderKey = (id: string): ItemKey => `folder:${id}`
export const fileKey = (id: string): ItemKey => `file:${id}`

export function splitKeys(keys: Iterable<ItemKey>) {
  const folders: string[] = []
  const files: string[] = []
  for (const key of keys) {
    if (key.startsWith('folder:')) folders.push(key.slice(7))
    else files.push(key.slice(5))
  }
  return { folders, files }
}

export type Selection = { keys: ReadonlySet<ItemKey>; anchor: ItemKey | null }

export const EMPTY_SELECTION: Selection = { keys: new Set(), anchor: null }

/**
 * A click on `key` as file managers do it: plain selects it alone, ⌘/Ctrl toggles it, Shift
 * selects the range from the anchor (added to the rest with ⌘/Ctrl as well).
 */
export function clickSelect(
  current: Selection,
  key: ItemKey,
  order: readonly ItemKey[],
  modifiers: { shift: boolean; toggle: boolean },
): Selection {
  if (modifiers.shift && current.anchor && order.includes(current.anchor)) {
    const from = order.indexOf(current.anchor)
    const to = order.indexOf(key)
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
    const keys = new Set(modifiers.toggle ? current.keys : [])
    for (const entry of range) keys.add(entry)
    return { keys, anchor: current.anchor }
  }
  if (modifiers.toggle) {
    const keys = new Set(current.keys)
    if (!keys.delete(key)) keys.add(key)
    return { keys, anchor: key }
  }
  return { keys: new Set([key]), anchor: key }
}

/** A checkbox click: toggles its item, Shift selects the range from the anchor (⌘/Ctrl+Shift adds it). */
export const checkModifiers = (event: {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}) => ({
  shift: event.shiftKey,
  toggle: !event.shiftKey || event.metaKey || event.ctrlKey,
})

/** Arrow-key movement through a grid of `columns` (1 for the list): the index to focus next. */
export function moveFocus(
  index: number,
  count: number,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
  columns: number,
) {
  if (count === 0) return -1
  if (index < 0) return 0
  const step = { ArrowUp: -columns, ArrowDown: columns, ArrowLeft: -1, ArrowRight: 1 }
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return Math.min(count - 1, Math.max(0, index + step[key]))
}

export type Rect = { left: number; top: number; right: number; bottom: number }

export const intersects = (a: Rect, b: Rect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/** The rubber band between where the drag started and where the pointer is. */
export const bandRect = (x1: number, y1: number, x2: number, y2: number): Rect => ({
  left: Math.min(x1, x2),
  top: Math.min(y1, y2),
  right: Math.max(x1, x2),
  bottom: Math.max(y1, y2),
})

// ---- drag and drop ----

/** Our own drags carry this type, so drops can tell them from files dragged in from the desktop. */
export const DRAG_TYPE = 'application/x-helvetly-documents'

/** `from`: the folder the files are shown in (null = top level, '*' = search results from anywhere). */
export type DragPayload = { files: string[]; folders: string[]; from: string | null }

// The browser hides drag data until the drop, so drop targets read what is being dragged from here.
let active: DragPayload | null = null
export const setActiveDrag = (payload: DragPayload | null) => {
  active = payload
}
export const activeDrag = () => active

/** Files dragged in from the desktop (not one of ours). */
export const isDesktopDrag = (data: DataTransfer | null) =>
  !!data && data.types.includes('Files') && !data.types.includes(DRAG_TYPE)

export const isOurDrag = (data: DataTransfer | null) => !!data && data.types.includes(DRAG_TYPE)

/**
 * Whether the dragged items may drop into `target` (null = top level): never a folder into
 * itself or below itself, and not where they already all are.
 */
export function canDrop(folders: Folder[], payload: DragPayload, target: string | null) {
  if (payload.files.length + payload.folders.length === 0) return false
  if (target && payload.folders.some((id) => isWithin(folders, target, id))) return false
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parent_id]))
  const foldersStay = payload.folders.every((id) => (parentOf.get(id) ?? null) === target)
  const filesStay = payload.files.length === 0 || payload.from === target
  return !(foldersStay && filesStay)
}

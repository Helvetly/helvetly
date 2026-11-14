'use client'

import { createContext, use, useState, type DragEvent } from 'react'

import type { Folder } from '@/lib/documents'

import {
  activeDrag,
  canDrop,
  DRAG_TYPE,
  isDesktopDrag,
  isOurDrag,
  setActiveDrag,
  type DragPayload,
} from './selection'

/** What drops do, given by the page: move our items, upload desktop files, or trash. */
export type DropActions = {
  folders: Folder[]
  move: (payload: DragPayload, target: string | null) => void
  upload: (files: File[], target: string | null) => void
  trash: (payload: DragPayload) => void
}

const DropContext = createContext<DropActions | null>(null)
export const DropProvider = DropContext.Provider

/**
 * Makes an element a drop target for a folder (`null` = top level) or the Trash: it lights up
 * while a valid drag hovers and does the move, upload or trash on drop.
 */
export function useDropTarget(target: string | null | 'trash') {
  const actions = use(DropContext)
  const [over, setOver] = useState(false)
  const accepts = (event: DragEvent) => {
    if (!actions) return false
    if (isDesktopDrag(event.dataTransfer)) return target !== 'trash'
    const payload = activeDrag()
    if (!isOurDrag(event.dataTransfer) || !payload) return false
    return target === 'trash' || canDrop(actions.folders, payload, target)
  }
  return {
    over,
    props: {
      'data-drop-over': over || undefined,
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = isDesktopDrag(event.dataTransfer) ? 'copy' : 'move'
        setOver(true)
        setDropHint(
          target === 'trash'
            ? 'Move to Trash'
            : `Move to ${target === null ? 'All documents' : (actions?.folders.find((folder) => folder.id === target)?.name ?? 'folder')}`,
        )
      },
      onDragLeave: (event: DragEvent) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setOver(false)
          setDropHint(null)
        }
      },
      onDrop: (event: DragEvent) => {
        setOver(false)
        if (!actions || !accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        const payload = activeDrag()
        if (isDesktopDrag(event.dataTransfer)) {
          if (target !== 'trash') actions.upload([...event.dataTransfer.files], target)
        } else if (payload) {
          if (target === 'trash') actions.trash(payload)
          else actions.move(payload, target)
        }
        setActiveDrag(null)
      },
    },
  }
}

// The card that follows the pointer while our items are dragged: what moves, and where to.
// Plain DOM, not React: it lives outside the page tree and must update on every dragover.
let chip: { root: HTMLDivElement; hint: HTMLSpanElement; stop: () => void } | null = null

const IDLE_HINT = 'Drop on a folder or the Trash'

function setDropHint(text: string | null) {
  if (!chip) return
  chip.hint.textContent = text ?? IDLE_HINT
  chip.root.dataset.target = text ? 'on' : 'off'
}

function showChip(label: string, count: number) {
  chip?.stop()
  const root = document.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  root.style.cssText =
    'position:fixed;top:0;left:0;z-index:9999;pointer-events:none;display:grid;gap:2px;' +
    'padding:8px 12px;border-radius:10px;background:#18181b;color:#fff;font:500 13px/1.35 system-ui,sans-serif;' +
    'box-shadow:0 10px 30px rgb(0 0 0/.28);max-width:280px;transform:translate(-100px,-100px)'
  const title = document.createElement('span')
  title.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
  title.textContent = label
  const hint = document.createElement('span')
  hint.style.cssText =
    'font-weight:400;font-size:12px;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
  root.append(title, hint)
  if (count > 1) {
    const badge = document.createElement('span')
    badge.textContent = String(count)
    badge.style.cssText =
      'position:absolute;top:-8px;right:-8px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;' +
      'background:#0ea5e9;color:#fff;font:600 11px/20px system-ui,sans-serif;text-align:center'
    root.append(badge)
  }
  document.body.append(root)
  const follow = (event: globalThis.DragEvent) => {
    root.style.transform = `translate(${event.clientX + 16}px, ${event.clientY + 14}px)`
    // Left every target: say what to do instead of keeping a stale "Move to …".
    if (!(event.target instanceof Element) || !event.target.closest('[data-drop-over]'))
      setDropHint(null)
  }
  const stop = () => {
    document.removeEventListener('dragover', follow)
    document.removeEventListener('dragend', stop)
    document.removeEventListener('drop', stop)
    root.remove()
    if (chip?.root === root) chip = null
  }
  document.addEventListener('dragover', follow)
  document.addEventListener('dragend', stop)
  document.addEventListener('drop', stop)
  chip = { root, hint, stop }
  setDropHint(null)
}

let blank: HTMLImageElement | null = null

/** Starts dragging our items; the browser's own image is hidden in favour of the chip above. */
export function startDrag(event: DragEvent, payload: DragPayload, label: string) {
  setActiveDrag(payload)
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(DRAG_TYPE, '1')
  event.dataTransfer.setData('text/plain', label)
  blank ??= Object.assign(new Image(), {
    src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  })
  event.dataTransfer.setDragImage(blank, 0, 0)
  showChip(label, payload.files.length + payload.folders.length)
}

export const endDrag = () => {
  setActiveDrag(null)
  chip?.stop()
}

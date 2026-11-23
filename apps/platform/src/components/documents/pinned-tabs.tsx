import type { Action } from '@helvetly/ui/components/action-menu'
import { Pin, PinOff } from 'lucide-react'
import { useState } from 'react'

import { KINDS, type Kind, type ViewParams } from '@/lib/documents'
import { translate } from '@/lib/i18n'

/** A view the person pinned as a header tab, next to the fixed "All files". Folders are never
 * tabs: browsing them stays in "All files". */
export type PinnedTab =
  | { type: 'kind'; kind: Kind }
  | { type: 'recent' }
  | { type: 'trash' }
  | { type: 'signatures' }
  | { type: 'templates' }

// shortcut: tabs live in this browser only; move them to the user's settings once the API has them.
const STORAGE_KEY = 'helvetly:documents-tabs'

export const sameTab = (a: PinnedTab, b: PinnedTab) => JSON.stringify(a) === JSON.stringify(b)

function isTab(value: unknown): value is PinnedTab {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  switch (value.type) {
    case 'recent':
    case 'trash':
    case 'signatures':
    case 'templates':
      return true
    case 'kind':
      return (
        'kind' in value &&
        typeof value.kind === 'string' &&
        (KINDS as readonly string[]).includes(value.kind)
      )
    default:
      return false
  }
}

/** Storage is the person's own, but can hold anything: keep only well-formed, unique tabs. */
export function parseTabs(raw: string | null): PinnedTab[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(value)) return []
    return value
      .filter(isTab)
      .filter((tab, index, all) => all.findIndex((other) => sameTab(other, tab)) === index)
  } catch {
    return []
  }
}

/** The tab a view stands for, if it is a view one can pin; a folder belongs to "All files". */
export function tabOfView(view: ViewParams): PinnedTab | null {
  if (view.section === 'recent') return { type: 'recent' }
  if (view.section === 'trash') return { type: 'trash' }
  if (view.section === 'signatures') return { type: 'signatures' }
  if (view.section === 'templates') return { type: 'templates' }
  if (view.folder) return null
  const [kind] = view.kinds
  return view.kinds.length === 1 && kind ? { type: 'kind', kind } : null
}

export function usePinnedTabs() {
  const [tabs, setTabs] = useState<PinnedTab[]>(() => {
    try {
      return parseTabs(localStorage.getItem(STORAGE_KEY))
    } catch {
      return []
    }
  })
  const save = (next: PinnedTab[]) => {
    setTabs(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {}
  }
  const has = (tab: PinnedTab) => tabs.some((entry) => sameTab(entry, tab))
  return {
    tabs,
    has,
    toggle: (tab: PinnedTab) =>
      save(has(tab) ? tabs.filter((entry) => !sameTab(entry, tab)) : [...tabs, tab]),
    move: (from: number, to: number) => {
      const tab = tabs[from]
      if (!tab || to < 0 || to >= tabs.length) return
      const next = tabs.filter((_, index) => index !== from)
      next.splice(to, 0, tab)
      save(next)
    },
  }
}

export type Pinned = ReturnType<typeof usePinnedTabs>

/** "Add as tab" / "Remove tab" for a place, in any right-click menu. */
export function pinAction(pinned: Pinned, tab: PinnedTab): Action {
  const on = pinned.has(tab)
  return {
    id: 'pin',
    group: 'status',
    icon: on ? <PinOff /> : <Pin />,
    label: on ? translate('removeTab') : translate('addAsTab'),
    onSelect: () => pinned.toggle(tab),
  }
}

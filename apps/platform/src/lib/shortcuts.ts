'use client'

import { createMatcher, isApple, isTypingTarget, type Keys } from '@helvetly/ui/lib/shortcuts'
import { useEffect, useRef, useSyncExternalStore } from 'react'

export type Shortcut = {
  label: string
  group: 'General' | 'Navigation' | 'Appearance' | 'On a page'
  /** Alternatives; see `Keys`. Single keys act only outside text fields, dialogs and menus. */
  keys: readonly Keys[]
}

/** Every app-wide keyboard shortcut: what the shortcuts dialog lists and `useShortcut` listens for. */
export const SHORTCUTS = {
  quickActions: { label: 'Open Quick Actions', group: 'General', keys: ['/', 'mod+k'] },
  heidi: { label: 'Open or close Heidi', group: 'General', keys: ['mod+j'] },
  help: { label: 'Help & feedback', group: 'General', keys: ['h'] },
  shortcuts: { label: 'Keyboard shortcuts', group: 'General', keys: ['?'] },
  sidebar: { label: 'Show or hide the sidebar', group: 'Navigation', keys: ['mod+b'] },
  notifications: { label: 'Go to Notifications', group: 'Navigation', keys: ['g n'] },
  theme: { label: 'Switch theme: light, dark, system', group: 'Appearance', keys: ['d'] },
  newRecord: { label: 'New record, like the page’s “New” button', group: 'On a page', keys: ['n'] },
} as const satisfies Record<string, Shortcut>

export type ShortcutId = keyof typeof SHORTCUTS

/** Whether a dialog or menu is open: single keys belong to it then. */
const overlayOpen = () =>
  document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null

/**
 * Runs `handler` when the shortcut's keys are pressed. ⌘/Ctrl combinations work anywhere, even in a
 * text field; single keys and sequences only while nothing is being typed and no dialog or menu is open.
 */
export function useShortcut(id: ShortcutId, handler: () => void, enabled = true) {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    const match = createMatcher(SHORTCUTS[id].keys)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      const plain = !event.metaKey && !event.ctrlKey
      if (plain && (isTypingTarget(event.target) || overlayOpen())) return
      if (!match(event)) return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [id, enabled])
}

const subscribeNever = () => () => {}

/** ⌘ or Ctrl: known only in the browser, so the server render assumes Ctrl. */
export function useApple() {
  return useSyncExternalStore(subscribeNever, isApple, () => false)
}

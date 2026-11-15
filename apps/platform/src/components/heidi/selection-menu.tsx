'use client'
import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, Copy, TextQuote } from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'

import { translate } from '@/lib/i18n'

import { toQuote } from './quote'

/** Half the menu's width, so it never sticks out of the panel. */
const EDGE = 84
/** Room the menu needs above the selection before it flips below it. */
const ABOVE = 44

type Spot = { text: string; quote: string; top: number; left: number; below: boolean }

/** Where the menu for the current selection goes, or null when nothing in one answer is selected. */
export function selectionSpot(root: HTMLElement, viewport: HTMLElement): Spot | null {
  const picked = document.getSelection()
  if (!picked || picked.isCollapsed || !picked.rangeCount) return null
  const range = picked.getRangeAt(0)
  const common = range.commonAncestorContainer
  const answer = (common instanceof Element ? common : common.parentElement)?.closest(
    '[data-answer]',
  )
  const text = picked.toString()
  const quote = toQuote(text)
  if (!answer || !root.contains(answer) || !quote) return null
  const rect = range.getBoundingClientRect()
  const view = viewport.getBoundingClientRect()
  if (rect.bottom < view.top || rect.top > view.bottom) return null
  const outer = root.getBoundingClientRect()
  // On touch the system's own selection bar sits above the text, so ours goes below it.
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const below = touch || rect.top - Math.max(outer.top, view.top) < ABOVE
  return {
    text,
    quote,
    top: (below ? rect.bottom : rect.top) - outer.top,
    left: Math.min(
      Math.max(rect.left + rect.width / 2 - outer.left, EDGE),
      Math.max(outer.width - EDGE, EDGE),
    ),
    below,
  }
}

/**
 * A small menu by text selected inside one of Heidi's answers: "Quote" puts it above the composer
 * for the next message, "Copy" copies it. Shift+F10 or the context-menu key moves focus into it;
 * Escape, a click elsewhere or scrolling closes it.
 */
export function SelectionMenu({
  root,
  scroller,
  onQuote,
}: {
  root: RefObject<HTMLElement | null>
  scroller: RefObject<HTMLElement | null>
  onQuote: (quote: string) => void
}) {
  const [spot, setSpot] = useState<Spot | null>(null)
  const [copied, setCopied] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  const read = useEffectEvent(() => {
    // Focus inside the menu moves the selection on some browsers; keep the menu while it is used.
    if (menu.current?.contains(document.activeElement)) return
    setCopied(false)
    setSpot(root.current && scroller.current ? selectionSpot(root.current, scroller.current) : null)
  })

  const close = useEffectEvent((restore: boolean) => {
    setSpot(null)
    setCopied(false)
    if (restore && menu.current?.contains(document.activeElement)) returnFocus.current?.focus()
    returnFocus.current = null
  })

  const onDocumentKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (!spot) return
    if (event.key === 'Escape') {
      // Captured first, so Escape closes only the menu, not the panel around it.
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      if (document.activeElement instanceof HTMLElement)
        returnFocus.current = document.activeElement
      menu.current?.querySelector('button')?.focus()
    }
  })

  const onPointerDown = useEffectEvent((event: PointerEvent) => {
    if (spot && !(event.target instanceof Node && menu.current?.contains(event.target)))
      close(false)
  })

  useEffect(() => {
    const select = () => read()
    const key = (event: globalThis.KeyboardEvent) => onDocumentKey(event)
    const pointer = (event: PointerEvent) => onPointerDown(event)
    const dismiss = () => close(false)
    const element = scroller.current
    document.addEventListener('selectionchange', select)
    document.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', pointer, true)
    element?.addEventListener('scroll', dismiss, { passive: true })
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('selectionchange', select)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('pointerdown', pointer, true)
      element?.removeEventListener('scroll', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [scroller])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => close(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])

  if (!spot) return null

  const quote = () => {
    onQuote(spot.quote)
    returnFocus.current = null
    setSpot(null)
    document.getSelection()?.removeAllRanges()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(spot.text)
      setCopied(true)
    } catch {
      close(true)
    }
  }

  // Arrow keys move between the two buttons, as in any toolbar.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = [...(menu.current?.querySelectorAll('button') ?? [])]
    const at = buttons.findIndex((button) => button === event.target)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <div
      ref={menu}
      role="toolbar"
      aria-label={translate('selectedText')}
      aria-orientation="horizontal"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // Keeps the selection while a button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        'absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-elevation-2 motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in',
        spot.below ? 'translate-y-1.5' : '-translate-y-[calc(100%+6px)]',
      )}
      style={{ top: spot.top, left: spot.left }}
    >
      <Button type="button" variant="ghost" size="sm" onClick={quote}>
        <TextQuote />
        {translate('quote')}
      </Button>
      <Button type="button" variant="ghost" size="sm" tabIndex={-1} onClick={() => void copy()}>
        {copied ? <Check className="text-success" /> : <Copy />}
        <span aria-live="polite">{copied ? translate('copied2') : translate('copy5')}</span>
      </Button>
    </div>
  )
}

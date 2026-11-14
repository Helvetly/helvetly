'use client'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@helvetly/ui/components/context-menu'
import { Copy, FileCode, TextQuote } from 'lucide-react'
import { useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { toast } from 'sonner'

import { toQuote } from './quote'

/**
 * The selected text inside `within`, clipped to it: a triple-click selection ends just past the
 * message, and only this message's part of it belongs in the menu.
 */
export function selectionIn(within: Element) {
  const picked = document.getSelection()
  if (!picked || picked.isCollapsed || !picked.rangeCount) return ''
  const range = picked.getRangeAt(0)
  if (!range.intersectsNode(within)) return ''
  const clipped = range.cloneRange()
  if (!within.contains(range.startContainer)) clipped.setStart(within, 0)
  if (!within.contains(range.endContainer)) clipped.setEnd(within, within.childNodes.length)
  return clipped.toString()
}

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied to the clipboard.'),
    () => toast.error('Couldn’t copy the text.'),
  )
}

type Opened = { selection: string; quote: string; plain: string }

/**
 * The menu a right-click on one of the conversation's messages opens: with text selected, "Quote in
 * reply" (the same quote the selection toolbar makes) and "Copy"; always "Copy message", and for an
 * answer "Copy as Markdown" when that differs. Shift or Alt keeps the browser's own menu, and touch
 * or pen input never opens it, so long-press selection stays the system's.
 */
export function MessageMenu({
  children,
  plain,
  markdown,
  onQuote,
}: {
  children: ReactElement
  /** The message as plain text, read when the menu opens. */
  plain: () => string
  /** The answer's Markdown source, offered when it differs from the plain text. */
  markdown?: string
  onQuote: (quote: string) => void
}) {
  const [opened, setOpened] = useState<Opened | null>(null)
  const [touch, setTouch] = useState(false)
  const quoted = useRef(false)

  const onContextMenuCapture = (event: MouseEvent<HTMLElement>) => {
    // Stopping it here skips the trigger's handler, which would otherwise suppress the browser's menu.
    if (event.shiftKey || event.altKey || touch) {
      event.stopPropagation()
      return
    }
    const selection = selectionIn(event.currentTarget)
    setOpened({ selection, quote: toQuote(selection), plain: plain() })
  }

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger
        asChild
        // A disabled trigger also clears its long-press timer, which would open the menu on touch.
        disabled={touch}
        style={{ WebkitTouchCallout: 'default' }}
        onPointerDownCapture={(event) => setTouch(event.pointerType !== 'mouse')}
        onContextMenuCapture={onContextMenuCapture}
      >
        {children}
      </ContextMenuTrigger>
      {opened && (
        <ContextMenuContent
          aria-label="Message"
          // Narrow enough to open beside the pointer on either side in a phone-wide window.
          className="w-48"
          onCloseAutoFocus={(event) => {
            // Quoting has moved focus to the composer; keep it there.
            if (quoted.current) event.preventDefault()
            quoted.current = false
          }}
        >
          {opened.quote && (
            <>
              <ContextMenuItem
                onSelect={() => {
                  quoted.current = true
                  document.getSelection()?.removeAllRanges()
                  onQuote(opened.quote)
                }}
              >
                <TextQuote /> Quote in reply
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => copy(opened.selection)}>
                <Copy /> Copy
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={() => copy(opened.plain)}>
            <Copy /> Copy message
          </ContextMenuItem>
          {markdown && markdown.trim() !== opened.plain.trim() && (
            <ContextMenuItem onSelect={() => copy(markdown)}>
              <FileCode /> Copy as Markdown
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <p className="px-1.5 py-1 text-caption text-balance text-muted-foreground">
            Shift + right-click for the browser’s menu
          </p>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}

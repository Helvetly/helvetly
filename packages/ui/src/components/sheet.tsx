'use client'
import { Button } from '@helvetly/ui/components/button'
import { leaveExitGhost } from '@helvetly/ui/lib/exit-ghost'
import { translate } from '@helvetly/ui/lib/i18n'
import { cn } from 'cn'
import { XIcon } from 'lucide-react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import * as React from 'react'

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

// One motion for every drawer: it slides in from its edge and back out the same way, the backdrop
// fading with it over the same time. Closing plays the opening curve in reverse (its mirror), so
// the drawer leaves at the speed it came instead of snapping away on an ease-out.
const MOTION =
  'duration-300 data-open:ease-[cubic-bezier(0.32,0.72,0,1)] data-closed:ease-[cubic-bezier(1,0,0.68,0.28)]'

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        MOTION,
        className,
      )}
      {...props}
    />
  )
}

/** The open sheet unmounted in the current commit, which a sheet mounted in the same commit replaces. */
let vacated: { content: HTMLElement; taken: boolean } | null = null

const animations = (element: HTMLElement | null) =>
  element && typeof element.getAnimations === 'function' ? element.getAnimations() : []

/** What Esc does inside a sheet when something in it registered with useSheetEscape. */
type EscapeSlot = { set: (handler: (() => void) | null) => void; get: () => (() => void) | null }
const SheetEscapeContext = React.createContext<EscapeSlot | null>(null)

function escapeSlot(): EscapeSlot {
  let current: (() => void) | null = null
  return {
    set: (handler) => {
      current = handler
    },
    get: () => current,
  }
}

/**
 * Esc runs `handler` instead of closing the sheet, e.g. an editor's Cancel that asks before throwing
 * typed work away. A popover, menu or dialog open inside the sheet still takes Esc first.
 */
function useSheetEscape(handler: () => void) {
  const escape = React.useContext(SheetEscapeContext)
  React.useEffect(() => {
    if (!escape) return
    escape.set(handler)
    return () => {
      if (escape.get() === handler) escape.set(null)
    }
  }, [escape, handler])
}

/**
 * Where focus goes back when a drawer closes: the control that opened it or, when that control sat in
 * a popover or menu that closes as the drawer opens (a row's card), that popover's trigger.
 */
function returnTargets(active: Element | null): HTMLElement[] {
  if (!(active instanceof HTMLElement) || active === document.body) return []
  const host = active.closest<HTMLElement>('[role=dialog][id], [role=menu][id]')
  const trigger = host
    ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(host.id)}"]`)
    : null
  return trigger ? [active, trigger] : [active]
}

// The return targets of the last focused control, taken while it is still in the page and its popover
// still open: one that closes in the same commit as the drawer opens is gone, or unlinked, by then.
let lastFocused: HTMLElement[] = []
// From import, not from the first drawer: the card that opens a drawer is focused before any drawer exists.
if (typeof document !== 'undefined')
  document.addEventListener('focusin', (event) => {
    const targets = returnTargets(event.target instanceof Element ? event.target : null)
    if (targets.length) lastFocused = targets
  })

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  onInteractOutside,
  onEscapeKeyDown,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ref,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  showCloseButton?: boolean
}) {
  const overlay = React.useRef<HTMLDivElement>(null)
  const content = React.useRef<HTMLDivElement>(null)
  const [escape] = React.useState(escapeSlot)
  const opener = React.useRef<HTMLElement[]>([])
  React.useLayoutEffect(() => {
    const elements = [overlay.current, content.current]
    // Taking the place of a sheet that just left (a loading sheet becoming the form, a detail
    // becoming its editor): one drawer stays on screen, so it neither slides in again nor out.
    if (vacated && !vacated.taken && vacated.content !== content.current) {
      vacated.taken = true
      for (const element of elements)
        for (const animation of animations(element)) animation.finish()
    }
    return () => {
      const node = content.current
      if (!node || node.getAttribute('data-state') !== 'open') return
      const slot = { content: node, taken: false }
      vacated = slot
      queueMicrotask(() => {
        if (vacated === slot) vacated = null
      })
      // Most drawers close by being unmounted; they still slide out instead of vanishing.
      leaveExitGhost(elements, () => slot.taken)
    }
  }, [])

  return (
    <SheetPortal>
      <SheetOverlay ref={overlay} />
      <SheetPrimitive.Content
        ref={(node) => {
          content.current = node
          if (typeof ref === 'function') return ref(node)
          if (ref) ref.current = node
        }}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition outline-none data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-[side=bottom]:data-open:slide-in-from-bottom data-[side=left]:data-open:slide-in-from-left data-[side=right]:data-open:slide-in-from-right data-[side=top]:data-open:slide-in-from-top data-closed:animate-out data-[side=bottom]:data-closed:slide-out-to-bottom data-[side=left]:data-closed:slide-out-to-left data-[side=right]:data-closed:slide-out-to-right data-[side=top]:data-closed:slide-out-to-top',
          MOTION,
          className,
        )}
        {...props}
        // Drawers close only on × or Esc: a stray click outside must never throw away work.
        onInteractOutside={(event) => {
          onInteractOutside?.(event)
          event.preventDefault()
        }}
        // Focus starts on the drawer itself, not its first button: a tooltip opened by that focus
        // would take the first Esc, and the drawer would seem not to close.
        onOpenAutoFocus={(event) => {
          // Radix asks before it moves focus in, so this is still the control that opened the drawer.
          // Taken at focus time: a popover closing in this same commit has already dropped its link.
          const active = document.activeElement
          const fresh = active && active !== document.body && lastFocused[0] !== active
          opener.current = fresh ? returnTargets(active) : lastFocused
          onOpenAutoFocus?.(event)
          if (event.defaultPrevented) return
          event.preventDefault()
          content.current?.focus({ preventScroll: true })
        }}
        // Radix refocuses only a SheetTrigger; a drawer opened from a row, a menu or the URL would
        // leave focus on <body>. Give it back to what opened the drawer, unless focus already moved
        // on (a drawer replacing this one).
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          // Not a control in a popover still fading out: it is about to leave the page.
          const target = opener.current.find(
            (element) =>
              element.isConnected &&
              !element.closest(':is([role=dialog], [role=menu])[data-state=closed]'),
          )
          const active = document.activeElement
          const lost = !active || active === document.body || content.current?.contains(active)
          if (event.defaultPrevented || !lost || !target) return
          event.preventDefault()
          target.focus({ preventScroll: true })
        }}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event)
          const handler = escape.get()
          if (event.defaultPrevented || !handler) return
          event.preventDefault()
          handler()
        }}
      >
        <SheetEscapeContext.Provider value={escape}>{children}</SheetEscapeContext.Provider>
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
              <XIcon />
              <span className="sr-only">{translate('close')}</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-0.5 p-4', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-heading text-base font-medium text-foreground', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  useSheetEscape,
}

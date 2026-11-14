'use client'

import { Button } from '@helvetly/ui/components/button'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Bell, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from 'react'

import { NotificationPrefs } from './notification-prefs'

/** A link from outside the app (an email, the unsubscribe page, an old settings tab) opens the drawer. */
export const PREFS_HREF = '/notifications?prefs=1'

const asked = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('prefs') === '1'

const OpenPrefsContext = createContext<(() => void) | null>(null)

/**
 * The notification preferences drawer, over whatever page is open: opened in place from the
 * Notifications page, the bell's bubble and the command palette, or by `?prefs=1` in the address.
 */
export function NotificationPrefsDrawers({ children }: { children: ReactNode }) {
  // A full page load with ?prefs=1 (an email, the unsubscribe page, another tab) starts open.
  const [open, setOpen] = useState(asked)
  // The address says whether it is open, like a record's ?id=, but only through the history API:
  // a router navigation would re-render the page under the drawer.
  const show = useCallback(() => {
    setOpen(true)
    markInAddress(true)
  }, [])
  const hide = useCallback(() => {
    setOpen(false)
    markInAddress(false)
  }, [])

  return (
    <OpenPrefsContext.Provider value={show}>
      {children}
      <NotificationPrefsDrawer open={open} onClose={hide} />
    </OpenPrefsContext.Provider>
  )
}

function markInAddress(open: boolean) {
  const query = new URLSearchParams(window.location.search)
  if (open === query.has('prefs')) return
  if (open) query.set('prefs', '1')
  else query.delete('prefs')
  const search = query.size > 0 ? `?${query}` : ''
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + search + window.location.hash,
  )
}

// A new tab or window asked for with a modifier key or the middle button keeps the plain link.
const modified = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

/** A link to the preferences that opens the drawer in place where it can, the page otherwise. */
export function PrefsLink({ onClick, ...props }: Omit<ComponentProps<typeof Link>, 'href'>) {
  const open = useContext(OpenPrefsContext)
  return (
    <Link
      href={PREFS_HREF}
      onClick={(event) => {
        onClick?.(event)
        if (!open || modified(event)) return
        event.preventDefault()
        open()
      }}
      {...props}
    />
  )
}

/** Opens the drawer from code (the command palette); without the drawers around, goes to the page. */
export function useOpenNotificationPrefs() {
  const open = useContext(OpenPrefsContext)
  const router = useRouter()
  return () => (open ? open() : router.push(PREFS_HREF))
}

/**
 * Where the preferences used to be (the settings tab, `/account#notifications`): go to the
 * Notifications page with the drawer open. With `hash`, only when the address has that hash.
 */
export function useRedirectToPrefs(hash?: string) {
  const open = useContext(OpenPrefsContext)
  const router = useRouter()
  useEffect(() => {
    if (hash && window.location.hash !== hash) return
    if (!open) return router.replace(PREFS_HREF)
    router.replace('/notifications')
    open()
  }, [hash, open, router])
}

export function NotificationPrefsDrawer({
  open = true,
  onClose,
}: {
  open?: boolean
  onClose: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        // Focus stays on the sheet, not its × (whose tooltip Esc would close first).
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(640px,100vw)]! dark:bg-card"
      >
        <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3 sm:px-5">
          <IconTile icon={Bell} variant="section" size="md" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <SheetTitle className="text-title-sm font-medium">Notification preferences</SheetTitle>
            <SheetDescription className="text-body-sm text-pretty text-muted-foreground">
              What Helvetly tells you about, by email and in the bell. Yours alone, in every
              workspace.
            </SheetDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </header>
        <NotificationPrefs />
      </SheetContent>
    </Sheet>
  )
}

'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { useTranslate } from '@helvetly/ui/components/language-provider'
import { LanguageDialog, LanguageMenuItem } from '@helvetly/ui/components/language-switcher'
import { Loader } from '@helvetly/ui/components/loader'
import { ThemeToggle } from '@helvetly/ui/components/theme-toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { errorMessage } from '@helvetly/ui/lib/http'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  House,
  LogOut,
  UserRound,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  createContext,
  cloneElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'
import {
  getPortalScope,
  getPortalSession,
  portalKeys,
  signOutPortal,
  switchPortalClient,
  type PortalSession,
} from '@/lib/portal'
import { useSessionsVisible } from '@/lib/scheduling'
import { scoped, unscoped } from '@/lib/scope'
import { shorten } from '@/lib/text'

import { LoginAvatar, PortalLoadError, WorkspaceMark } from './portal-bits'

const NAV = [
  { href: '/', label: translate('overview'), icon: House },
  { href: '/invoices', label: translate('invoices'), icon: FileText },
  { href: '/engagements', label: translate('engagements'), icon: Gauge },
  { href: '/documents', label: translate('documents'), icon: FolderOpen },
]

/** Shown when the plan has Scheduling and the client has sessions or may book (`useSessionsVisible`). */
const SESSIONS = { href: '/sessions', label: translate('sessions'), icon: CalendarDays }

const SessionContext = createContext<PortalSession | null>(null)

/** The signed-in portal session; only valid below `PortalShell`. */
export function usePortalSession(): PortalSession {
  const session = useContext(SessionContext)
  if (!session) throw new Error(translate('useportalsessionMustBeUsedInsidePortalShell'))
  return session
}

/** True in a member's read-only preview of the client's portal (false outside a signed-in page). */
export function useIsPreview() {
  return Boolean(useContext(SessionContext)?.preview)
}

/**
 * A write action: in a preview its control is off and its tooltip says why (the API refuses it anyway). The wrapper
 * takes the pointer a disabled button no longer does, so the tooltip still shows; the banner says it to everyone.
 */
export function PreviewLock({ children }: { children: ReactElement<{ disabled?: boolean }> }) {
  if (!useIsPreview()) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex rounded-md">{cloneElement(children, { disabled: true })}</span>
      </TooltipTrigger>
      <TooltipContent>{translate('readOnlyPreview')}</TooltipContent>
    </Tooltip>
  )
}

/** Says, on every page of a preview, whose portal this is, that it is read-only and who opened it. */
function PreviewBanner({ session, onEnd }: { session: PortalSession; onEnd: () => void }) {
  if (!session.preview) return null
  return (
    <output className="flex min-h-10 items-center gap-3 border-b bg-brand-surface px-4 py-1.5 text-body-sm text-foreground sm:px-6 lg:px-8">
      <Eye aria-hidden className="size-4 shrink-0 stroke-[1.75] text-brand" />
      <span className="min-w-0 flex-1">
        {translate('previewBanner', {
          client: session.client.name,
          member: session.preview.started_by,
        })}
      </span>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onEnd}>
        {translate('endPreview')}
      </Button>
    </output>
  )
}

function AccountMenu({
  session,
  onSwitch,
  onLanguage,
  onSignOut,
  triggerRef,
}: {
  session: PortalSession
  onSwitch: (id: string) => void
  onLanguage: () => void
  onSignOut: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const translateUi = useTranslate()
  // Radix gives focus back to the button when the menu closes; after a mouse that focus must not draw the
  // keyboard ring, so the button is focused again without it. The keyboard still gets the ring.
  const openedByPointer = useRef(false)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            {/* The avatar alone on narrow screens; from lg up a pill with the client's name beside it. */}
            <Button
              ref={triggerRef}
              variant="ghost"
              onPointerDown={() => (openedByPointer.current = true)}
              onKeyDown={() => (openedByPointer.current = false)}
              className="h-10 min-w-10 gap-2 rounded-full p-0 lg:max-w-60 lg:justify-start lg:pr-4 lg:pl-1"
            >
              <span className="sr-only">
                {translate('accountMenu')}, {session.client.name}
              </span>
              <LoginAvatar name={session.client.name} src={session.avatar_url} />
              <span
                aria-hidden
                className="hidden truncate text-body font-medium text-foreground lg:block"
                title={session.client.name}
              >
                {session.client.name}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {/* Only the lone avatar needs it; from lg up the name is on the button. */}
        <TooltipContent className="lg:hidden">{session.client.name}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        onCloseAutoFocus={(event) => {
          if (!openedByPointer.current) return
          event.preventDefault()
          triggerRef.current?.focus({ focusVisible: false })
        }}
        className="w-72 max-w-[calc(100vw-2rem)] rounded-xl p-1.5 shadow-elevation-2 [&_[role=menuitem]]:h-9 [&_[role=menuitemradio]]:min-h-9"
      >
        <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2 font-normal">
          <LoginAvatar name={session.client.name} src={session.avatar_url} />
          <span className="grid min-w-0 leading-tight">
            <span className="truncate text-body text-foreground">{session.client.name}</span>
            {session.email && (
              <span className="truncate text-body-sm text-muted-foreground">{session.email}</span>
            )}
          </span>
        </DropdownMenuLabel>
        {session.clients.length > 1 && !session.preview && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2 pt-1 pb-1 text-xs font-normal text-muted-foreground">
              {translate('switchClient')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={session.client.id} onValueChange={onSwitch}>
              {session.clients.map((client) => (
                <DropdownMenuRadioItem key={client.id} value={client.id}>
                  <span className="grid min-w-0 leading-tight">
                    <span className="truncate">{client.name}</span>
                    {client.workspace_name !== session.workspace.name && (
                      <span className="truncate text-xs text-muted-foreground">
                        {client.workspace_name}
                      </span>
                    )}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={scoped('/profile')}>
            <UserRound />
            {translate('profile2')}
          </Link>
        </DropdownMenuItem>
        <LanguageMenuItem onSelect={onLanguage} />
        <DropdownMenuSeparator />
        {/* The platform account menu's Theme row. */}
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <span aria-hidden className="text-sm">
            {translateUi('theme')}
          </span>
          <ThemeToggle inMenu />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut />
          {translate('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Tabs in the header from `md` up; below, a fixed bottom tab bar with icons and labels. The active tab is a soft
 * pill in the platform sidebar's active colours (on phones only the icon carries it), never an underline.
 */
function PortalNav({ pathname }: { pathname: string }) {
  const nav = useSessionsVisible() ? [NAV[0]!, SESSIONS, ...NAV.slice(1)] : NAV
  return (
    <nav
      aria-label={translate('portal')}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] md:static md:shrink-0 md:border-0 md:bg-transparent md:pb-0"
    >
      <ul className="grid auto-cols-fr grid-flow-col md:flex md:h-16 md:items-center md:gap-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === href : pathname.startsWith(href)
          return (
            <li key={href} className="md:flex">
              <Link
                href={scoped(href)}
                aria-current={active ? 'page' : undefined}
                data-active={active || undefined}
                // A pointer press does not take focus, so no browser can draw the keyboard ring after a
                // click; the pill marks the active tab, and Tab still reaches every link.
                onMouseDown={(event) => event.preventDefault()}
                // Not cn(): tailwind-merge would drop the type-scale size for the colour.
                className="group/tab flex flex-col items-center gap-0.5 rounded-md pt-1.5 pb-1.5 text-caption font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:h-9 md:flex-row md:gap-2 md:px-3 md:py-0 md:text-body md:hover:bg-sidebar-accent/60 data-active:text-brand md:data-active:bg-brand-surface"
              >
                {/* On phones the pill sits behind the icon only; from md up the whole tab is the pill. */}
                <span className="grid h-7 w-12 place-items-center rounded-full transition-colors group-hover/tab:bg-sidebar-accent/60 group-data-active/tab:bg-brand-surface md:contents">
                  <Icon aria-hidden className="size-5 stroke-[1.75] md:size-4 md:max-lg:hidden" />
                </span>
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const BRAND_CHARS = 16

/** The supplier's mark and name, cut after 16 characters; the whole name is in its tooltip and accessible name. */
function WorkspaceBrand({ name, logoUrl }: { name: string; logoUrl?: string }) {
  const short = shorten(name, BRAND_CHARS)
  const label = (
    <span className="truncate text-body font-semibold" aria-label={name}>
      {short}
    </span>
  )
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <WorkspaceMark name={name} logoUrl={logoUrl} />
      <span className="grid min-w-0 leading-tight">
        {short === name ? (
          label
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>{label}</TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
          </Tooltip>
        )}
        <span className="truncate text-caption text-muted-foreground">
          {translate('clientPortal')}
        </span>
      </span>
    </div>
  )
}

/**
 * Marks the header scrolled while the page is scrolled away from the top, so its shadow shows only once content
 * passes under it. Set on the node, not in state: a scroll must not re-render the page.
 */
function markScrolled(header: HTMLElement | null) {
  if (!header) return
  const update = () => header.toggleAttribute('data-scrolled', window.scrollY > 0)
  update()
  window.addEventListener('scroll', update, { passive: true })
  return () => window.removeEventListener('scroll', update)
}

/**
 * Gate and frame of every portal page: no session goes to the portal's own sign-in. `logoUrl` is the
 * supplier's logo when the portal knows it (initials otherwise).
 */
export function PortalShell({ children, logoUrl }: { children: ReactNode; logoUrl?: string }) {
  const router = useRouter()
  const pathname = unscoped(usePathname() ?? '').replace(/\/$/, '') || '/'
  const queryClient = useQueryClient()
  const [languageOpen, setLanguageOpen] = useState(false)
  const accountButton = useRef<HTMLButtonElement>(null)
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch,
  } = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })

  const { data: scope } = useQuery({
    queryKey: portalKeys.scope,
    queryFn: getPortalScope,
    retry: false,
  })

  useEffect(() => {
    if (session === null) router.replace(scoped('/login'))
  }, [session, router])

  if (!session && sessionError) return <PortalLoadError retry={() => void refetch()} />
  if (isPending || !session) return <Loader size="page" className="min-h-svh" />

  const switchClient = async (id: string) => {
    if (id === session.client.id) return
    try {
      await switchPortalClient(id)
      // Not clear(): on '/' nothing re-renders the shell, which would keep the old client. Resetting
      // drops the old answers and refetches what is on screen.
      void queryClient.resetQueries()
      router.replace(scoped('/'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  const signOut = async () => {
    try {
      await signOutPortal()
      queryClient.clear()
      // A preview's tab was opened by the app for it: it closes; were it kept, it shows the sign-in.
      if (session.preview) window.close()
      router.replace(scoped('/login'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <SessionContext.Provider value={session}>
      <div className="min-h-svh bg-background pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <header
          ref={markScrolled}
          className="sticky top-0 z-30 border-b bg-card transition-shadow duration-150 ease-out data-scrolled:shadow-(--sticky-shadow)"
        >
          <PreviewBanner session={session} onEnd={() => void signOut()} />
          {/* Full width: the brand sits at the far left, the tabs and account menu at the far right. */}
          <div className="flex h-16 items-center gap-4 px-4 sm:px-6 md:gap-6 lg:px-8">
            <WorkspaceBrand
              name={session.workspace.name}
              logoUrl={logoUrl ?? scope?.logo_url ?? undefined}
            />
            <PortalNav pathname={pathname} />
            <div className="shrink-0">
              <AccountMenu
                session={session}
                onSwitch={(id) => void switchClient(id)}
                onLanguage={() => setLanguageOpen(true)}
                onSignOut={() => void signOut()}
                triggerRef={accountButton}
              />
              {/* Outside the menu, so the menu closing does not take the dialog with it. */}
              <LanguageDialog
                open={languageOpen}
                onOpenChange={setLanguageOpen}
                returnFocus={accountButton}
              />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pt-6 pb-10 sm:px-6 sm:pt-10 sm:pb-16 lg:px-8">
          {children}
        </main>
      </div>
    </SessionContext.Provider>
  )
}

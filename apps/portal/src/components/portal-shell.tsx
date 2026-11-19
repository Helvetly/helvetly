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
import { LanguageMenuItems } from '@helvetly/ui/components/language-switcher'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { errorMessage } from '@helvetly/ui/lib/http'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePenLine, FileText, FolderOpen, Gauge, House, LogOut, UserRound } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, type ReactNode } from 'react'
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
import { scoped, unscoped } from '@/lib/scope'

import { LoginAvatar, WorkspaceMark } from './portal-bits'

const NAV = [
  { href: '/', label: translate('overview'), icon: House },
  { href: '/invoices', label: translate('invoices'), icon: FileText },
  { href: '/quotes', label: translate('quotes'), icon: FilePenLine },
  { href: '/engagements', label: translate('engagements'), icon: Gauge },
  { href: '/documents', label: translate('documents'), icon: FolderOpen },
]

const SessionContext = createContext<PortalSession | null>(null)

/** The signed-in portal session; only valid below `PortalShell`. */
export function usePortalSession(): PortalSession {
  const session = useContext(SessionContext)
  if (!session) throw new Error(translate('useportalsessionMustBeUsedInsidePortalShell'))
  return session
}

function AccountMenu({
  session,
  onSwitch,
  onSignOut,
}: {
  session: PortalSession
  onSwitch: (id: string) => void
  onSignOut: () => void
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="size-10 rounded-full p-0">
              <span className="sr-only">
                {translate('accountMenu')}, {session.client.name}
              </span>
              <LoginAvatar name={session.client.name} src={session.avatar_url} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{session.client.name}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
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
        {session.clients.length > 1 && (
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
        <LanguageMenuItems />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut />
          {translate('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Underlined tabs in the header from `md` up; below, a fixed bottom tab bar with icons and labels. */
function PortalNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label={translate('portal')}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] md:static md:shrink-0 md:border-0 md:bg-transparent md:pb-0"
    >
      <ul className="grid grid-cols-5 md:flex md:h-16 md:gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === href : pathname.startsWith(href)
          return (
            <li key={href} className="md:flex">
              <Link
                href={scoped(href)}
                aria-current={active ? 'page' : undefined}
                // A pointer press does not take focus, so no browser can draw the keyboard ring after a
                // click; the underline marks the active tab, and Tab still reaches every link.
                onMouseDown={(event) => event.preventDefault()}
                // Not cn(): tailwind-merge would drop the type-scale size for the colour.
                // Transparent top and bottom borders keep the label centred above the underline.
                className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-caption font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:flex-row md:gap-2 md:border-y-2 md:border-transparent md:px-3 md:py-0 md:text-body ${active ? 'text-foreground md:border-b-brand' : 'text-muted-foreground md:hover:border-b-border'}`}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'size-5 stroke-[1.75] md:size-4 md:max-lg:hidden',
                    active && 'text-brand',
                  )}
                />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** The supplier's mark and name; a long name is cut short with the whole of it in a tooltip. */
function WorkspaceBrand({ name, logoUrl }: { name: string; logoUrl?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <WorkspaceMark name={name} logoUrl={logoUrl} />
      <span className="grid min-w-0 leading-tight">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate text-body font-semibold">{name}</span>
          </TooltipTrigger>
          <TooltipContent>{name}</TooltipContent>
        </Tooltip>
        <span className="truncate text-caption text-muted-foreground">
          {translate('clientPortal')}
        </span>
      </span>
    </div>
  )
}

/**
 * Gate and frame of every portal page: no session goes to the portal's own sign-in. `logoUrl` is the
 * supplier's logo when the portal knows it (initials otherwise).
 */
export function PortalShell({ children, logoUrl }: { children: ReactNode; logoUrl?: string }) {
  const router = useRouter()
  const pathname = unscoped(usePathname() ?? '').replace(/\/$/, '') || '/'
  const queryClient = useQueryClient()
  const { data: session, isPending } = useQuery({
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

  if (isPending || !session) return null

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
      router.replace(scoped('/login'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <SessionContext.Provider value={session}>
      <div className="min-h-svh bg-background pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* No backdrop-filter here: it would trap the fixed bottom bar inside the header. */}
        <header className="sticky top-0 z-30 border-b bg-card">
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
                onSignOut={() => void signOut()}
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

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

import { LoginAvatar } from './portal-bits'
import { WorkspaceMark } from './workspace-mark'

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
            <Button variant="ghost" className="h-10 min-w-0 gap-2 rounded-full pr-1 pl-1 lg:pl-3">
              <span className="sr-only">{translate('accountMenu')}</span>
              <span className="max-w-44 truncate font-normal max-lg:hidden">
                {session.client.name}
              </span>
              <LoginAvatar name={session.client.name} src={session.avatar_url} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{translate('account')}</TooltipContent>
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

/** Pill tabs in the header from `md` up; below, a fixed bottom tab bar with icons and labels. */
function PortalNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label={translate('portal')}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] md:static md:border-0 md:bg-transparent md:pb-0"
    >
      <ul className="grid grid-cols-5 md:flex md:gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === href : pathname.startsWith(href)
          return (
            <li key={href}>
              <Link
                href={scoped(href)}
                aria-current={active ? 'page' : undefined}
                // Not cn(): tailwind-merge would drop the type-scale size for the colour.
                className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-caption font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:flex-row md:gap-1.5 md:rounded-full md:px-3 md:py-0 md:text-body-sm md:hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] ${active ? 'text-foreground md:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)]' : 'text-muted-foreground'}`}
              >
                <Icon
                  aria-hidden
                  className={cn('size-5 stroke-[1.75] md:size-4', active && 'text-brand')}
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

/** Gate and frame of every portal page: no session goes to the portal's own sign-in. */
export function PortalShell({ children }: { children: ReactNode }) {
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
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 md:gap-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <WorkspaceMark name={session.workspace.name} logoUrl={scope?.logo_url} />
              <span className="grid min-w-0 leading-tight">
                <span className="truncate text-body font-medium">{session.workspace.name}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {translate('clientPortal')}
                </span>
              </span>
            </div>
            <PortalNav pathname={pathname} />
            <div className="ml-auto shrink-0">
              <AccountMenu
                session={session}
                onSwitch={(id) => void switchClient(id)}
                onSignOut={() => void signOut()}
              />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 pt-5 pb-8 sm:pt-8">{children}</main>
      </div>
    </SessionContext.Provider>
  )
}

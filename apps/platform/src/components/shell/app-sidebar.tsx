'use client'
import { Avatar, AvatarFallback, AvatarImage } from '@helvetly/ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { LanguageMenuItems } from '@helvetly/ui/components/language-switcher'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@helvetly/ui/components/sidebar'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { capitalize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronsUpDown,
  Keyboard,
  LifeBuoy,
  LogOut,
  Settings,
  Plus,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { useHeidi } from '@/components/heidi/heidi-provider'
import { HelpDialog } from '@/components/help/help-dialog'
import { initialsOf } from '@/components/initials'
import { NotificationsBell } from '@/components/notifications/notifications-bell'
import { ShortcutKeys, WithShortcut } from '@/components/shortcuts/shortcut-keys'
import { ShortcutsDialog } from '@/components/shortcuts/shortcuts-dialog'
import { AddWorkspaceDialog } from '@/components/workspaces/add-workspace-dialog'
import { api, setCsrfToken, type Session, type User } from '@/lib/api'
import { useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import { useSwitchWorkspace, useWorkspaces, type WorkspaceItem } from '@/lib/members'
import { effectiveScopes } from '@/lib/permissions'
import { useShortcut } from '@/lib/shortcuts'

import { CommandPalette } from './command-palette'
import { visibleNav } from './nav'
import { planLabel, SidebarPlanNotice } from './plan-notice'
import { ThemeSwitcher } from './theme-switcher'

export const isCurrent = (pathname: string, href: string) => {
  const path = pathname.replace(/\/$/, '') || '/'
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`)
}

/**
 * The path a nav marks current: a clicked item lights up at once, not when its page has loaded, and a
 * later route change wins. Resting the pointer on an item starts loading its page's list.
 */
export function useNavTarget() {
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const [clicked, setClicked] = useState<{ href: string; from: string } | null>(null)
  return {
    current: clicked?.from === pathname ? clicked.href : pathname,
    linkProps: (href: string) => ({
      onClick: () => setClicked({ href, from: pathname }),
      // Loaded on demand, so the shell does not carry every page's queries.
      onPointerEnter: () =>
        void import('@/lib/warm').then(({ warmPage }) => warmPage(queryClient, href)),
    }),
  }
}

const itemClass =
  'h-9 gap-2.5 rounded-lg px-2.5 text-[15px] font-normal text-sidebar-foreground transition-[color,background-color,box-shadow] duration-150 data-active:bg-white data-active:font-medium data-active:hover:bg-white data-active:shadow-[0_1px_3px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.04)] dark:data-active:bg-white/[0.08] dark:data-active:shadow-none [&_svg]:size-[18px]! [&_svg]:stroke-[1.5] [&_svg]:text-[#7f7f81] dark:[&_svg]:text-muted-foreground data-active:text-sidebar-accent-foreground data-active:[&_svg]:text-sidebar-accent-foreground'

/** The workspace's initial on a dark tile: a stand-in until workspaces can upload a logo. */
// The letter keeps its colour on the tile: menu items recolour every child on hover.
function WorkspaceMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-linear-to-b from-[#3a3a3e] to-[#1c1c1f] text-[14px] font-semibold text-white! shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.12)] dark:from-[#f4f4f5] dark:to-[#dcdcdf] dark:text-[#161618]!',
        className,
      )}
    >
      {initialsOf(name).slice(0, 1) || '?'}
    </span>
  )
}

/** The person's name, or the part of the email before the @. */
const displayName = (user: User) => user.name || user.email.split('@')[0] || user.email

export function AppSidebar({ session }: { session: Session }) {
  const { current, linkProps } = useNavTarget()
  const { setOpenMobile, toggleSidebar } = useSidebar()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [addingWorkspace, setAddingWorkspace] = useState(false)
  // Null until the dialog is first opened, so it costs nothing before.
  const [help, setHelp] = useState<{ open: boolean } | null>(null)
  const openHelp = () => {
    setOpenMobile(false)
    setHelp({ open: true })
  }
  const heidi = useHeidi()
  const router = useRouter()
  useShortcut('quickActions', () => setPaletteOpen(true))
  useShortcut('help', openHelp)
  useShortcut('shortcuts', () => setShortcutsOpen(true))
  useShortcut('sidebar', toggleSidebar)
  useShortcut('notifications', () => router.push('/notifications'))
  const switchWorkspace = useSwitchWorkspace()
  const billing = useBilling().data
  // Until the list loads, the current workspace comes from the session.
  const workspaces: WorkspaceItem[] = useWorkspaces().data ?? [
    { ...session.workspace, role: session.role, current: true },
  ]
  const switchTo = (workspace: WorkspaceItem) => {
    if (workspace.current) return
    switchWorkspace.mutate(workspace.id, {
      onSuccess: () => router.replace('/'),
      onError: toastError,
    })
  }

  return (
    <Sidebar variant="inset" collapsible="icon" className="absolute h-full">
      <SidebarHeader className="gap-4 px-2 pt-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="h-12 gap-2.5 rounded-xl px-2 transition-colors duration-150 group-data-[collapsible=icon]:p-0! hover:bg-black/[0.04] dark:hover:bg-white/[0.06] data-open:bg-black/[0.04] dark:data-open:bg-white/[0.06]">
              <WorkspaceMark name={session.workspace.name} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-[14px] font-semibold text-[#161618] dark:text-foreground">
                  {session.workspace.name}
                </span>
                {/* The plan, not the role (that is in the user menu); the role while billing is off. */}
                <span
                  className="truncate text-[12px] text-[#8e8d90] dark:text-muted-foreground"
                  data-testid="workspace-plan"
                >
                  {planLabel(billing) ?? capitalize(session.role)}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto size-4! stroke-[1.75] text-[#a8a7aa]" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-xl p-1.5"
          >
            <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-[12px] font-normal text-[#a8a7aa] dark:text-muted-foreground">
              {translate('workspaces')}
            </DropdownMenuLabel>
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                className="gap-2.5 rounded-lg px-2 py-1.5"
                onSelect={() => switchTo(workspace)}
              >
                <WorkspaceMark name={workspace.name} className="size-7 rounded-[7px] text-[12px]" />
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate text-[14px] text-[#161618] dark:text-foreground">
                    {workspace.name}
                  </span>
                  <span className="text-[12px] text-[#8e8d90] capitalize dark:text-muted-foreground">
                    {workspace.role}
                  </span>
                </span>
                {workspace.current && <Check className="ml-auto text-foreground" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="my-1.5" />
            <DropdownMenuItem
              className="gap-2.5 rounded-lg px-2 py-1.5"
              onSelect={() => setAddingWorkspace(true)}
            >
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-dashed border-[#d4d4d7] text-[#8e8d90] dark:border-white/20 dark:text-muted-foreground"
              >
                <Plus className="size-4" />
              </span>
              <span className="text-[14px] text-[#161618] dark:text-foreground">
                {translate('addWorkspace')}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {addingWorkspace && <AddWorkspaceDialog onClose={() => setAddingWorkspace(false)} />}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={{
                children: <WithShortcut label={translate('quickActions')} id="quickActions" />,
              }}
              onClick={() => setPaletteOpen(true)}
              aria-expanded={paletteOpen}
              // Compact: the height and type of a nav row, a hairline shadow instead of a raised card.
              className="h-8 gap-2 rounded-lg bg-[#fdfdfd] px-2.5 text-[13.5px] text-[#6b6a6d] shadow-[0_0_0_1px_rgb(0_0_0/0.04),0_1px_2px_rgb(0_0_0/0.04)] hover:bg-white hover:text-foreground active:bg-white aria-expanded:bg-white aria-expanded:text-foreground dark:bg-card dark:text-muted-foreground dark:active:bg-card [&_svg]:size-4! [&_svg]:stroke-[1.5]"
            >
              <Zap />
              <span>{translate('quickActions')}</span>
              <kbd className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-[#d6d6d8] bg-transparent px-1 font-sans text-[10.5px] text-[#bdbdc0] group-data-[collapsible=icon]:hidden dark:border-border dark:text-muted-foreground">
                /
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onHelp={openHelp}
          onShortcuts={() => setShortcutsOpen(true)}
        />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        {help && <HelpDialog open={help.open} onOpenChange={(open) => setHelp({ open })} />}
      </SidebarHeader>
      <SidebarContent className="gap-1 px-0 py-1">
        {visibleNav(effectiveScopes(session.role, session.scopes)).map((group, index) => (
          <SidebarGroup
            key={group.label ?? index}
            className={cn('py-1', group.bottom && 'mt-auto')}
          >
            {group.label && (
              <SidebarGroupLabel className="h-8 px-2.5 text-[13px] font-normal text-[#a8a7aa] dark:text-muted-foreground">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu className="gap-px">
              {group.items.map(({ label, icon: Icon, href, isNew, heidi: opensHeidi, bell }) =>
                bell ? (
                  <SidebarMenuItem key={label}>
                    <NotificationsBell className={itemClass} onGo={() => setOpenMobile(false)} />
                  </SidebarMenuItem>
                ) : (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      asChild={Boolean(href)}
                      tooltip={
                        opensHeidi ? { children: <WithShortcut label={label} id="heidi" /> } : label
                      }
                      isActive={href ? isCurrent(current, href) : false}
                      aria-expanded={opensHeidi ? Boolean(heidi?.open) : undefined}
                      className={itemClass}
                      onClick={
                        href
                          ? undefined
                          : opensHeidi
                            ? () => {
                                setOpenMobile(false)
                                heidi?.setOpen(!heidi.open)
                              }
                            : () => toast(translate('isComingSoon', { label: label }))
                      }
                    >
                      {href ? (
                        <Link
                          href={href}
                          {...linkProps(href)}
                          onClick={() => {
                            setOpenMobile(false)
                            linkProps(href).onClick()
                          }}
                        >
                          <Icon />
                          <span>{label}</span>
                          {isNew && <NewTag />}
                        </Link>
                      ) : (
                        <>
                          <Icon />
                          <span>{label}</span>
                          {isNew && <NewTag />}
                        </>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="gap-2 px-2 pb-3">
        <SidebarPlanNotice
          billing={billing}
          workspaceId={session.workspace.id}
          onGo={() => setOpenMobile(false)}
        />
        <UserMenu
          user={session.user}
          role={session.role}
          workspace={session.workspace.name}
          onHelp={openHelp}
          onShortcuts={() => setShortcutsOpen(true)}
        />
      </SidebarFooter>
    </Sidebar>
  )
}

function NewTag() {
  return (
    <span className="rounded-[4px] bg-heidi px-1.5 text-[11px] leading-[18px] font-semibold tracking-wide text-background uppercase group-data-[collapsible=icon]:hidden">
      {translate('new3')}
    </span>
  )
}

function UserAvatar({ user }: { user: User }) {
  return (
    <Avatar className="size-8">
      {user.avatar_url && <AvatarImage src={user.avatar_url} alt="" />}
      <AvatarFallback className="bg-white text-[11px] font-medium text-zinc-700 shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-black/[0.06] ring-inset dark:bg-zinc-700 dark:text-zinc-200 dark:ring-white/10">
        {initialsOf(displayName(user))}
      </AvatarFallback>
    </Avatar>
  )
}

/** The person at the bottom of the sidebar and their account menu. */
function UserMenu({
  user,
  role,
  workspace,
  onHelp,
  onShortcuts,
}: {
  user: User
  role: Session['role']
  workspace: string
  onHelp: () => void
  onShortcuts: () => void
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSettled: () => {
      setCsrfToken('')
      queryClient.clear()
      router.replace('/login')
    },
  })

  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="h-12 min-w-0 flex-1 gap-2.5 rounded-lg px-1.5 group-data-[collapsible=icon]:p-0!">
              <UserAvatar user={user} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-body font-medium" title={displayName(user)}>
                  {displayName(user)}
                </span>
                <span className="truncate text-caption text-muted-foreground" title={user.email}>
                  {user.email}
                </span>
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-72 rounded-xl p-1.5 shadow-elevation-2 [&_[role=menuitem]]:h-9 [&_[role=menuitem]]:text-[15px] [&_svg]:stroke-[1.5]"
          >
            {/* Name and email each get the full width; the role sits on its own line with the workspace. */}
            <DropdownMenuLabel className="flex items-start gap-2.5 px-2 py-2 font-normal">
              <UserAvatar user={user} />
              <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
                <span
                  className="line-clamp-2 text-title-sm font-medium break-words text-foreground"
                  title={displayName(user)}
                >
                  {displayName(user)}
                </span>
                <span className="truncate text-body-sm" title={user.email}>
                  {user.email}
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-caption">
                  <StatusBadge>{capitalize(role)}</StatusBadge>
                  <span className="truncate">{workspace}</span>
                </span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account">
                <Settings />
                {translate('settings2')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onHelp}>
              <LifeBuoy />
              {translate('helpFeedback2')}
              <DropdownMenuShortcut>
                <ShortcutKeys id="help" />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onShortcuts}>
              <Keyboard />
              {translate('keyboardShortcuts')}
              <DropdownMenuShortcut>
                <ShortcutKeys id="shortcuts" />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <LanguageMenuItems />
            <ThemeSwitcher />
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={signOut.isPending} onSelect={() => signOut.mutate()}>
              <LogOut />
              {translate('logOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

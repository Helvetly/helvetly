'use client'
import { Avatar, AvatarFallback, AvatarImage } from '@helvetly/ui/components/avatar'
import { Badge } from '@helvetly/ui/components/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Kbd } from '@helvetly/ui/components/kbd'
import { PlanBadge } from '@helvetly/ui/components/plan-badge'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
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
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'

import {
  featureLock,
  PLANS_HREF,
  PlanTag,
  toastLocked,
  useBillingStatus,
} from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { useHeidi } from '@/components/heidi/heidi-provider'
import { HelpDialog } from '@/components/help/help-dialog'
import { initialsOf } from '@/components/initials'
import { NotificationsBell } from '@/components/notifications/notifications-bell'
import { useSettingsHref } from '@/components/settings/settings-tabs'
import { WorkspaceMark } from '@/components/shared/workspace-mark'
import { ShortcutKeys, WithShortcut } from '@/components/shortcuts/shortcut-keys'
import { ShortcutsDialog } from '@/components/shortcuts/shortcuts-dialog'
import { AddWorkspaceDialog } from '@/components/workspaces/add-workspace-dialog'
import { api, setCsrfToken, type Session, type User } from '@/lib/api'
import { type Billing } from '@/lib/billing'
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
  'h-9 gap-2.5 rounded-lg px-2.5 text-[15px] leading-5 font-normal text-sidebar-foreground transition-[color,background-color,box-shadow] duration-150 data-active:bg-white data-active:font-medium data-active:hover:bg-white data-active:shadow-[0_1px_3px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.04)] dark:data-active:bg-white/[0.08] dark:data-active:shadow-none [&_svg]:size-[18px]! [&_svg]:stroke-[1.5] [&_svg]:text-[#7f7f81] dark:[&_svg]:text-muted-foreground data-active:text-brand data-active:[&_svg]:text-brand'

/** The person's name, or the part of the email before the @. */
const displayName = (user: User) => user.name || user.email.split('@')[0] || user.email

export function AppSidebar({ session }: { session: Session }) {
  const { current, linkProps } = useNavTarget()
  const { setOpenMobile, toggleSidebar } = useSidebar()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
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
  const { billing } = useBillingStatus()

  return (
    <Sidebar variant="inset" collapsible="icon" className="absolute h-full">
      <SidebarHeader className="gap-4 px-2 pt-4">
        <WorkspaceSwitcher session={session} />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={{
                children: <WithShortcut label={translate('quickActions')} id="quickActions" />,
              }}
              onClick={() => setPaletteOpen(true)}
              aria-expanded={paletteOpen}
              // A quiet grey well without an edge, muted text; hover, focus and the open palette deepen it a step.
              className="h-8 gap-2 rounded-lg bg-black/[0.04] px-2.5 text-body-sm text-muted-foreground transition-colors duration-150 hover:bg-black/[0.06] hover:text-foreground focus-visible:bg-black/[0.06] active:bg-black/[0.06] aria-expanded:bg-black/[0.06] aria-expanded:text-foreground dark:bg-white/[0.04] dark:hover:bg-white/[0.07] dark:focus-visible:bg-white/[0.07] dark:active:bg-white/[0.07] dark:aria-expanded:bg-white/[0.07] [&_svg]:size-4! [&_svg]:stroke-[1.5]"
            >
              <Zap />
              <span>{translate('quickActions')}</span>
              <Kbd className="ml-auto border-transparent bg-black/[0.06] text-muted-foreground group-data-[collapsible=icon]:hidden dark:bg-white/[0.08]">
                /
              </Kbd>
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
              {group.items
                .filter((item) => !item.heidi || heidi)
                .map(
                  ({
                    label,
                    icon: Icon,
                    href,
                    isNew,
                    heidi: opensHeidi,
                    bell,
                    feature,
                    badge: Count,
                  }) => {
                    const lock = feature ? featureLock(billing, feature) : null
                    const tag = lock ? (
                      <PlanTag lock={lock} className="group-data-[collapsible=icon]:hidden" />
                    ) : Count ? (
                      <Count className="ml-auto group-data-[collapsible=icon]:hidden" />
                    ) : (
                      isNew && <NewTag />
                    )
                    return bell ? (
                      <SidebarMenuItem key={label}>
                        <NotificationsBell
                          className={itemClass}
                          onGo={() => setOpenMobile(false)}
                        />
                      </SidebarMenuItem>
                    ) : (
                      <SidebarMenuItem key={label}>
                        <SidebarMenuButton
                          asChild={Boolean(href)}
                          tooltip={
                            opensHeidi
                              ? { children: <WithShortcut label={label} id="heidi" /> }
                              : label
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
                                    if (lock) toastLocked(lock, () => router.push(PLANS_HREF))
                                    else heidi?.setOpen(!heidi.open)
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
                              {tag}
                            </Link>
                          ) : (
                            <>
                              <Icon />
                              <span>{label}</span>
                              {tag}
                            </>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  },
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
          onHelp={openHelp}
          onShortcuts={() => setShortcutsOpen(true)}
        />
      </SidebarFooter>
    </Sidebar>
  )
}

/** The workspace name with its plan badge, and the list to switch or add a workspace. */
export function WorkspaceSwitcher({ session }: { session: Session }) {
  const [addingWorkspace, setAddingWorkspace] = useState(false)
  const router = useRouter()
  const switchWorkspace = useSwitchWorkspace()
  const { billing } = useBillingStatus()
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton className="h-12 gap-2.5 rounded-xl px-2 transition-colors duration-150 group-data-[collapsible=icon]:p-0! hover:bg-black/[0.04] dark:hover:bg-white/[0.06] data-open:bg-black/[0.04] dark:data-open:bg-white/[0.06]">
            <WorkspaceMark name={session.workspace.name} logoUrl={session.workspace.logo_url} />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-[14px] font-semibold text-[#161618] dark:text-foreground">
                {session.workspace.name}
              </span>
              {/* The plan, not the role (that is in the user menu); nothing while billing is off or loading. */}
              {planLabel(billing) && (
                <PlanText testId="workspace-plan" plan={billing?.plan}>
                  {planLabel(billing)}
                </PlanText>
              )}
            </span>
            <ChevronsUpDown className="ml-auto size-4! stroke-[1.75] text-[#a8a7aa]" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-xl p-1.5"
        >
          <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-[12px] font-normal text-muted-foreground">
            {translate('workspaces')}
          </DropdownMenuLabel>
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              className="gap-2.5 rounded-lg px-2 py-1.5"
              onSelect={() => switchTo(workspace)}
            >
              <WorkspaceMark
                name={workspace.name}
                logoUrl={workspace.logo_url}
                className="size-7 rounded-[7px] text-[12px]"
              />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-[14px] text-[#161618] dark:text-foreground">
                  {workspace.name}
                </span>
                {rowPlan(workspace, billing) && (
                  <PlanText plan={workspace.plan ?? undefined}>
                    {rowPlan(workspace, billing)}
                  </PlanText>
                )}
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
    </>
  )
}

function NewTag() {
  return (
    <Badge
      variant="solid"
      tone="violet"
      size="sm"
      className="tracking-wide uppercase group-data-[collapsible=icon]:hidden"
    >
      {translate('new3')}
    </Badge>
  )
}

/** A workspace's own plan in its list row: nothing without a billing record, Free when it has no paid plan. */
function rowPlan(workspace: WorkspaceItem, billing: Billing | undefined): string | null {
  // Billing off (or not yet known) hides plans: records from when it was on would be stale.
  if (!billing?.enabled || workspace.plan == null) return null
  if (workspace.plan === '') return translate('planFree')
  return (
    billing?.plans.find((plan) => plan.id === workspace.plan)?.name ?? capitalize(workspace.plan)
  )
}

/** The plan as a small badge under a workspace name, in the plan's own tone. */
function PlanText({
  children,
  testId,
  plan,
}: {
  children: ReactNode
  testId?: string
  plan?: string
}) {
  return (
    <PlanBadge
      plan={plan}
      size="sm"
      data-testid={testId}
      className="mt-0.5 max-w-full justify-self-start truncate"
    >
      {children}
    </PlanBadge>
  )
}

function UserAvatar({ user, className }: { user: User; className?: string }) {
  return (
    // A rounded square in a thin border with a 2px gap: the gap sits inside the box, so the icon rail's 32px
    // button does not cut the border off. Without a photo, the initials on a soft blue tint.
    <Avatar
      className={cn('size-9 rounded-xl border border-foreground/15 p-0.5 after:hidden', className)}
    >
      {user.avatar_url && <AvatarImage src={user.avatar_url} alt="" className="rounded-lg" />}
      <AvatarFallback className="rounded-lg bg-info-surface text-caption font-semibold tracking-wide text-info">
        {initialsOf(displayName(user))}
      </AvatarFallback>
    </Avatar>
  )
}

/** The person at the bottom of the sidebar and their account menu. */
function UserMenu({
  user,
  onHelp,
  onShortcuts,
}: {
  user: User
  onHelp: () => void
  onShortcuts: () => void
}) {
  const router = useRouter()
  const { state, isMobile } = useSidebar()
  // Its tooltip only on the icon rail, where the avatar stands alone; elsewhere the name is on the button.
  const [tooltip, setTooltip] = useState(false)
  const settingsHref = useSettingsHref()
  useShortcut('settings', () => router.push(settingsHref))
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
      <SidebarMenuItem>
        <DropdownMenu>
          <Tooltip open={tooltip && state === 'collapsed' && !isMobile} onOpenChange={setTooltip}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="h-13 gap-2.5 rounded-xl px-2 transition-colors duration-150 group-data-[collapsible=icon]:p-0! hover:bg-black/[0.04] dark:hover:bg-white/[0.06] data-open:bg-black/[0.04] dark:data-open:bg-white/[0.06]">
                  <UserAvatar user={user} className="group-data-[collapsible=icon]:size-8" />
                  <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
                    <span
                      className="truncate text-body font-medium text-foreground"
                      title={displayName(user)}
                    >
                      {displayName(user)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground" title={user.email}>
                      {user.email}
                    </span>
                  </span>
                  <ChevronsUpDown className="ml-auto size-4! stroke-[1.75] text-foreground/60" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              {displayName(user)}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-72 rounded-xl p-1.5 shadow-elevation-2 [&_[role=menuitem]]:h-9 [&_[role=menuitem]]:text-[15px] [&_svg]:stroke-[1.5]"
          >
            {/* Name wraps to two lines, email stays on one: nothing can outgrow the popover. */}
            <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2 font-normal">
              <UserAvatar user={user} className="size-12" />
              <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
                <span
                  className="line-clamp-2 text-title-sm font-medium break-words text-foreground"
                  title={displayName(user)}
                >
                  {displayName(user)}
                </span>
                <span className="truncate text-xs text-muted-foreground" title={user.email}>
                  {user.email}
                </span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={settingsHref}>
                <Settings />
                {translate('settings2')}
                <DropdownMenuShortcut>
                  <ShortcutKeys id="settings" />
                </DropdownMenuShortcut>
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

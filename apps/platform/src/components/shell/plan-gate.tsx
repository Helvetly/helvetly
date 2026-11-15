'use client'

import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { Logo } from '@helvetly/ui/components/logo'
import { ThemeToggle } from '@helvetly/ui/components/theme-toggle'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Gift, Lock, LogOut } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'

import { PlanCards } from '@/components/billing/plan-cards'
import { toastError } from '@/components/billing/upgrade-prompt'
import { api, errorMessage, setCsrfToken, type Session } from '@/lib/api'
import { useBilling } from '@/lib/billing'
import { useSwitchWorkspace, useWorkspaces } from '@/lib/members'
import { useSession } from '@/lib/queries'

export const CHOOSE_PLAN_PATH = '/choose-plan'

/** Whether `pathname` is the plan picker (the static export serves it as /choose-plan/). */
export const isChoosePlan = (pathname: string) => pathname.replace(/\/$/, '') === CHOOSE_PLAN_PATH

/**
 * A workspace without an active plan is read-only: every page but billing sends to the plan picker,
 * a page of its own. Until billing answers nothing of the app shows, or a locked workspace would
 * flash it before the picker.
 */
export function PlanGate({ children }: { children: ReactNode }) {
  const billing = useBilling()
  const router = useRouter()
  const onBilling = (usePathname() ?? '').startsWith('/settings/billing')
  const locked = Boolean(billing.data?.enabled && billing.data.locked) && !onBilling

  useEffect(() => {
    if (locked) router.replace(CHOOSE_PLAN_PATH)
  }, [locked, router])

  // Only the first answer is waited for: after a failure (a member without billing access, say) the
  // app's own billing reads refetch it, and a refetch without data is pending again.
  if (
    (billing.isPending && billing.failureCount === 0 && billing.errorUpdateCount === 0) ||
    locked
  ) {
    return (
      <div className="flex min-h-svh flex-col bg-background">
        <Loader size="page" />
      </div>
    )
  }
  return children
}

/** The plan picker of a workspace without an active plan; a workspace with one goes home. */
export function ChoosePlan() {
  // The layout's AuthGate renders pages only once the session is in.
  const session = useSession().data
  const billing = useBilling()
  const router = useRouter()
  const data = billing.data
  const open = Boolean(data && !(data.enabled && data.locked))

  useEffect(() => {
    if (open) router.replace('/')
  }, [open, router])

  if (!session) return null
  if (!data || open) {
    return (
      <PlanScreen workspace={<WorkspaceSwitcher session={session} />} action={<SignOutButton />}>
        {billing.error ? (
          <p role="alert" className="mt-16 text-center text-sm text-muted-foreground">
            Plans couldn’t be loaded: {errorMessage(billing.error)}
          </p>
        ) : (
          <Loader label="Loading plans" className="min-h-96" />
        )}
      </PlanScreen>
    )
  }
  const trial = !data.has_customer && data.trial_available
  return (
    <PlanScreen workspace={<WorkspaceSwitcher session={session} />} action={<SignOutButton />}>
      {data.can_manage ? (
        <>
          <div className="grid max-w-2xl justify-items-center gap-4 text-center">
            {trial && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-surface/70 px-3 py-1 text-[12.5px] font-medium text-success ring-1 ring-success-solid/25 backdrop-blur">
                <Gift className="size-3.5" aria-hidden />
                {data.trial_days} days free on Basic
              </span>
            )}
            <h1 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.035em] text-balance sm:text-[46px]">
              Choose a plan for {session.workspace.name}
            </h1>
            <p className="max-w-xl text-[15px] text-pretty text-muted-foreground sm:text-[16px]">
              {data.has_customer
                ? 'Its plan has ended, so the workspace is read-only. Choose a plan and it opens again right away, with everything in it.'
                : 'Invoices with QR bills, expenses, clients, documents and signatures in one place. One price per person, the whole team on the same plan.'}
            </p>
          </div>
          <div className="mt-12 w-full max-w-[1080px]">
            <PlanCards billing={data} />
          </div>
        </>
      ) : (
        <div className="mt-16 grid max-w-md justify-items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Lock className="size-5" aria-hidden />
          </span>
          <h1 className="text-[24px] font-medium tracking-[-0.02em]">
            This workspace has no active plan
          </h1>
          <p className="text-[14px] text-pretty text-muted-foreground">
            It is read-only until an owner or admin chooses one. Ask them to open Plan & billing.
          </p>
        </div>
      )}
    </PlanScreen>
  )
}

/** The full-screen frame of the plan pickers: no sidebar, a slim bar on top, a marketing glow. */
export function PlanScreen({
  workspace,
  action,
  children,
}: {
  workspace?: ReactNode
  action: ReactNode
  children: ReactNode
}) {
  return (
    <div className="relative isolate flex min-h-svh min-w-[320px] flex-col overflow-x-clip bg-background">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(48rem_22rem_at_50%_-4rem,rgb(16_185_129/0.16),transparent_70%)]"
      />
      {workspace ? (
        <header className="flex h-16 items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Logo className="size-7" />
            {workspace}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            {action}
          </div>
        </header>
      ) : (
        <>
          {/* Without the bar the action is the way back, top left, and the theme top right. */}
          <div className="absolute top-3 left-4 md:top-4 md:left-6">{action}</div>
          <ThemeToggle className="absolute top-3 right-4 md:top-4 md:right-6" />
        </>
      )}
      <main
        className={cn(
          'flex flex-1 flex-col items-center px-4 pb-20',
          workspace ? 'pt-8 md:pt-14' : 'pt-0',
        )}
      >
        {/* Without the bar the logo sits halfway between the top of the screen and the heading. */}
        {!workspace && (
          <div className="flex h-24 items-center md:h-32">
            <Logo className="size-11" />
          </div>
        )}
        {children}
      </main>
    </div>
  )
}

function WorkspaceSwitcher({ session }: { session: Session }) {
  const router = useRouter()
  const workspaces = useWorkspaces().data ?? []
  const switchWorkspace = useSwitchWorkspace()
  const others = workspaces.filter((workspace) => !workspace.current)
  const name = <span className="truncate text-[14px] font-semibold">{session.workspace.name}</span>
  if (others.length === 0) return <span className="flex min-w-0 items-center">{name}</span>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="min-w-0 gap-1.5 px-2">
          {name}
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            disabled={switchWorkspace.isPending}
            onSelect={() =>
              !workspace.current &&
              switchWorkspace.mutate(workspace.id, {
                onSuccess: () => router.replace('/'),
                onError: toastError,
              })
            }
          >
            <span className="truncate">{workspace.name}</span>
            {workspace.current && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SignOutButton() {
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
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground"
      disabled={signOut.isPending}
      onClick={() => signOut.mutate()}
    >
      <LogOut className="size-3.5" /> Sign out
    </Button>
  )
}

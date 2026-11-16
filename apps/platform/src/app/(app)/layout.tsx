'use client'

import { SidebarInset, SidebarProvider } from '@helvetly/ui/components/sidebar'
import { usePathname } from 'next/navigation'
import { useState, useSyncExternalStore, type ReactNode } from 'react'

import { AIApprovalProvider } from '@/components/ai/ai-approval'
import { AuthGate } from '@/components/auth-gate'
import { isActivating } from '@/components/billing/activating'
import { HeidiPanel } from '@/components/heidi/heidi-panel'
import { HeidiProvider } from '@/components/heidi/heidi-provider'
import { NotificationPrefsDrawers } from '@/components/notifications/prefs-drawer'
import { isWelcome, OnboardingRedirect } from '@/components/onboarding/onboarding-redirect'
import { RecordDrawers } from '@/components/record-drawers'
import { AccessGate } from '@/components/shell/access-gate'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { MobileTabBar } from '@/components/shell/mobile-tab-bar'
import { isChoosePlan, PlanGate } from '@/components/shell/plan-gate'
import { PrimaryActionProvider } from '@/components/shell/primary-action'

// Tablets get the icon rail; phones (below 768px) get the sheet.
const SIDEBAR_KEY = 'helvetly:sidebar'
const RAIL = '(min-width: 768px) and (max-width: 1023px)'
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(RAIL)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * The app fills the screen: sidebar on the gray canvas, content in a white panel that scrolls
 * on its own.
 */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  const rail = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(RAIL).matches,
    () => false,
  )
  // The collapsed/expanded choice is a per-browser convenience; storage may be unavailable.
  // Only the AuthGate's client-side children read it, so the static HTML never depends on it.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== 'collapsed'
    } catch {
      return true
    }
  })
  // The welcome, the plan pickers and the wait after Checkout are pages of their own, without the sidebar.
  const pathname = usePathname()
  const bare =
    isWelcome(pathname) ||
    isChoosePlan(pathname) ||
    isActivating(pathname) ||
    pathname.replace(/\/$/, '') === '/settings/billing/plans'
  const toggle = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? 'expanded' : 'collapsed')
    } catch {}
  }

  return (
    <AuthGate>
      {(session) => (
        <OnboardingRedirect session={session}>
          {/* Above the shell, so Heidi opened from the welcome is still open after it. */}
          <AIApprovalProvider>
            <HeidiProvider
              key={`${session.user.id}:${session.workspace.id}`}
              scope={`${session.user.id}:${session.workspace.id}`}
            >
              {bare ? (
                children
              ) : (
                // Without an active plan every page sends to the plan picker (components/shell/plan-gate).
                <PlanGate>
                  {/* Below the smallest phone the page scrolls sideways instead of squeezing. */}
                  <div className="h-svh min-w-[320px] bg-background">
                    <SidebarProvider
                      open={open && !rail}
                      onOpenChange={toggle}
                      // ⌘B is registered with the platform's other shortcuts (AppSidebar).
                      keyboardShortcut={false}
                      className="relative h-full min-h-0 overflow-hidden bg-background"
                    >
                      <PrimaryActionProvider>
                        <RecordDrawers>
                          <NotificationPrefsDrawers>
                            <AppSidebar session={session} />
                            <SidebarInset className="@container min-w-0 overflow-y-auto bg-background pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 md:peer-data-[variant=inset]:my-2 md:peer-data-[variant=inset]:mr-2 md:peer-data-[variant=inset]:rounded-b-[14px] md:peer-data-[variant=inset]:shadow-none [&>header+*]:rounded-t-[14px] [&>header~*]:bg-card">
                              <AccessGate>{children}</AccessGate>
                            </SidebarInset>
                            <HeidiPanel />
                            <MobileTabBar />
                          </NotificationPrefsDrawers>
                        </RecordDrawers>
                      </PrimaryActionProvider>
                    </SidebarProvider>
                  </div>
                </PlanGate>
              )}
            </HeidiProvider>
          </AIApprovalProvider>
        </OnboardingRedirect>
      )}
    </AuthGate>
  )
}

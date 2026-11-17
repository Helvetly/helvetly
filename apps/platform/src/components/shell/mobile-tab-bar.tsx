'use client'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { useSidebar } from '@helvetly/ui/components/sidebar'
import { cn } from '@helvetly/ui/lib/utils'
import { Menu, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type ComponentType, type ReactNode } from 'react'
import { toast } from 'sonner'

import { useHeidi } from '@/components/heidi/heidi-provider'
import { useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import { useScopes } from '@/lib/permissions'

import { isCurrent, useNavTarget } from './app-sidebar'
import { startable, visibleNav } from './nav'
import { usePrimaryAction } from './primary-action'

// The pages a phone user opens daily; everything else is one tap away under Menu.
const TABS = ['/', '/invoices', '/clients']

/**
 * The phone's bottom bar: the daily pages, "+" and Menu for the full sidebar. "+" is the open page's
 * primary action (New invoice on Invoices); on a page without one it lists what can be created. Hidden from 768px up, where the sidebar is always on screen.
 */
export function MobileTabBar() {
  const { current, linkProps } = useNavTarget()
  const scopes = useScopes()
  const { setOpenMobile } = useSidebar()
  const [creating, setCreating] = useState(false)
  const primary = usePrimaryAction()
  const pages = visibleNav(scopes, useBilling().data).flatMap((group) => group.items)
  const tabs = TABS.flatMap((href) => pages.filter((item) => item.href === href))
  const [first, ...rest] = tabs

  return (
    <>
      <nav
        aria-label={translate('main')}
        className="fixed inset-x-0 bottom-0 z-40 grid min-w-[320px] grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {first && (
          <Tab
            {...first}
            current={isCurrent(current, first.href ?? '/')}
            link={linkProps(first.href ?? '/')}
          />
        )}
        {rest[0] && (
          <Tab
            {...rest[0]}
            current={isCurrent(current, rest[0].href ?? '/')}
            link={linkProps(rest[0].href ?? '/')}
          />
        )}
        <div className="flex items-center justify-center">
          <button
            type="button"
            aria-label={primary?.label ?? translate('create')}
            onClick={primary ? primary.run : () => setCreating(true)}
            className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_12px_rgb(0_0_0/0.2)] transition-transform active:scale-95"
          >
            <Plus className="size-5" />
          </button>
        </div>
        {rest[1] && (
          <Tab
            {...rest[1]}
            current={isCurrent(current, rest[1].href ?? '/')}
            link={linkProps(rest[1].href ?? '/')}
          />
        )}
        <TabButton label={translate('menu')} icon={Menu} onClick={() => setOpenMobile(true)} />
      </nav>
      {creating && <CreateSheet onClose={() => setCreating(false)} />}
    </>
  )
}

const tabClass =
  'flex h-16 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground transition-colors aria-[current=page]:text-foreground [&_svg]:size-[22px] [&_svg]:stroke-[1.5] aria-[current=page]:[&_svg]:stroke-2'

function Tab({
  label,
  icon: Icon,
  href = '/',
  current,
  link,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  href?: string
  current: boolean
  link: ReturnType<ReturnType<typeof useNavTarget>['linkProps']>
}) {
  return (
    <Link href={href} {...link} aria-current={current ? 'page' : undefined} className={tabClass}>
      <Icon />
      {label === 'Dashboard' ? translate('home') : label}
    </Link>
  )
}

function TabButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className={tabClass}>
      <Icon />
      {label}
    </button>
  )
}

/** "+": the records this person may create, and Heidi, in a sheet from the bottom. */
function CreateSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const scopes = useScopes()
  const billing = useBilling().data
  const heidi = useHeidi()
  const go = (action: () => void) => () => {
    onClose()
    action()
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-2xl px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <span aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <SheetTitle className="px-2 text-[15px] font-medium">{translate('create')}</SheetTitle>
        <SheetDescription className="sr-only">
          {translate('startANewRecordOrAskHeidi')}
        </SheetDescription>
        <div className="mt-2 grid gap-0.5">
          {heidi && (
            <Row icon={<HeidiSparkle />} onClick={go(() => heidi.ask())}>
              {translate('askHeidi')}
            </Row>
          )}
          {startable(scopes, billing).map(({ label, icon: Icon, href }) => (
            <Row
              key={label}
              icon={<Icon />}
              onClick={go(() =>
                href ? router.push(href) : toast(translate('isComingSoon', { label: label })),
              )}
            >
              {label}
            </Row>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Row({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-12 items-center gap-3 rounded-xl px-2 text-left text-[15px] active:bg-muted',
        '[&_svg]:size-5 [&_svg]:stroke-[1.5] [&_svg]:text-muted-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

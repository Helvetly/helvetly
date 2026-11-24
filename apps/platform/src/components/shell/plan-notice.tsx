'use client'
import { Button } from '@helvetly/ui/components/button'
import { Meter } from '@helvetly/ui/components/meter'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@helvetly/ui/components/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  CalendarClock,
  Clock,
  CreditCard,
  Lock,
  ShieldAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'

import {
  describeDiscount,
  formatPrice,
  freeForever,
  nextCharge,
  trialDaysLeft,
  type Billing,
  type Discount,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

type Tone = 'brand' | 'warning' | 'danger'
export type PlanNotice = {
  kind: 'trial' | 'payment' | 'disputed' | 'ending' | 'locked'
  tone: Tone
  title: string
  text: string
  /** Owners and admins only: the way out of the state. */
  action: { label: string; href: string } | null
  /** Days left of `of`, for the trial's countdown bar. */
  progress?: { left: number; of: number }
  /** A failed payment or a read-only workspace stays until it is solved. */
  dismissable: boolean
}

const PLANS = '/settings/billing/plans'
const BILLING = '/settings/billing'
const ASK = translate('askAnOwnerOrAdmin')
const failing = (status: string) => status === 'past_due' || status === 'unpaid'
const planName = (billing: Billing) =>
  billing.plans.find((plan) => plan.id === billing.plan)?.name ?? capitalizeId(billing.plan)
const capitalizeId = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)
const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`

/** What the trial turns into under the subscription's promotion code; the code itself stays private. */
function afterDiscount(billing: Billing, discount: Discount): string {
  if (freeForever(billing)) return translate('freeForever')
  const charge = nextCharge(billing)
  const price = charge && 'amount' in charge ? charge.amount : null
  const terms = describeDiscount(discount)
  return price && billing.interval
    ? `${formatPrice(price)} / ${billing.interval} with ${terms}`
    : translate('dynamicApplies', { terms: terms })
}

/** The workspace's plan under its name in the switcher: "Pro", "Basic · Payment due"; null without billing. */
export function planLabel(billing: Billing | undefined): string | null {
  if (!billing?.enabled) return null
  if (billing.locked) return translate('noPlanReadOnly')
  const name = planName(billing)
  if (failing(billing.status)) return translate('paymentDue', { name: name })
  return name
}

/** What the sidebar says about the plan, most urgent first; null when there is nothing to say. */
export function planNotice(billing: Billing | undefined, now = Date.now()): PlanNotice | null {
  if (!billing?.enabled) return null
  const manage = billing.can_manage
  if (billing.payment_overdue)
    return {
      kind: 'payment',
      tone: 'danger',
      title: translate('paymentFailed'),
      text: manage
        ? translate('paymentOverdueOnFree')
        : translate('paymentOverdueOnFreeAsk', { ASK: ASK }),
      action: manage ? { label: translate('updatePayment'), href: BILLING } : null,
      dismissable: false,
    }
  if (billing.locked)
    return {
      kind: 'locked',
      tone: 'danger',
      title: translate('readOnlyWorkspace'),
      text: manage
        ? translate('thereIsNoActivePlanChooseOneToMake')
        : translate('thereIsNoActivePlanToChooseOne', { ASK: ASK }),
      action: manage ? { label: translate('chooseAPlan'), href: PLANS } : null,
      dismissable: false,
    }
  if (failing(billing.status))
    return {
      kind: 'payment',
      tone: 'danger',
      title: translate('paymentFailed'),
      text: manage
        ? translate('updateTheCardSoTheWorkspaceStaysOpen')
        : translate('toUpdateTheCardSoTheWorkspaceStaysOpen', { ASK: ASK }),
      action: manage ? { label: translate('updatePayment'), href: BILLING } : null,
      dismissable: false,
    }
  if (billing.disputed)
    return {
      kind: 'disputed',
      tone: 'warning',
      title: translate('paymentDisputed'),
      text: translate('aPaymentIsDisputedWithTheCardIssuerThe'),
      action: null,
      dismissable: true,
    }
  if (billing.status === 'trialing' && billing.trial_end) {
    const left = trialDaysLeft(billing.trial_end, now)
    const ends = formatDate(billing.trial_end)
    const after = billing.cancel_at_period_end
      ? translate('theWorkspaceMovesToFree')
      : translate('billingStarts')
    const title =
      left === 0 ? translate('trialEndsToday') : translate('trialLeft', { value1: days(left) })
    const progress = { left, of: Math.max(billing.trial_days, left, 1) }
    if (billing.discount && !billing.cancel_at_period_end)
      return {
        kind: 'trial',
        tone: 'brand',
        title,
        text: translate('untilThen', {
          value1: planName(billing),
          ends: ends,
          value3: afterDiscount(billing, billing.discount),
        }),
        action: manage ? { label: translate('viewPlan'), href: BILLING } : null,
        progress,
        dismissable: true,
      }
    return {
      kind: 'trial',
      tone: 'brand',
      title,
      text: manage
        ? translate('untilThenPickThePlanThatFits', {
            value1: planName(billing),
            ends: ends,
            after: after,
          })
        : translate('untilToPickAPlan', { value1: planName(billing), ends: ends, ASK: ASK }),
      action: manage ? { label: translate('upgrade'), href: PLANS } : null,
      progress,
      dismissable: true,
    }
  }
  if (billing.cancel_at_period_end && billing.current_period_end)
    return {
      kind: 'ending',
      tone: 'warning',
      title: translate('planEnds', { value1: formatDate(billing.current_period_end) }),
      text: manage
        ? translate('afterThatTheWorkspaceMovesToFreeRenewTo')
        : translate('afterThatTheWorkspaceMovesToFreeToRenew', { ASK: ASK }),
      action: manage ? { label: translate('renewPlan'), href: BILLING } : null,
      dismissable: true,
    }
  return null
}

const ICONS: Record<PlanNotice['kind'], LucideIcon> = {
  trial: Clock,
  payment: CreditCard,
  disputed: ShieldAlert,
  ending: CalendarClock,
  locked: Lock,
}
const CARD: Record<Tone, string> = {
  brand: 'border-sidebar-border bg-card',
  warning: 'border-warning-border bg-warning-surface',
  danger: 'border-destructive/30 bg-destructive-surface',
}
const INK: Record<Tone, string> = {
  brand: 'text-brand',
  warning: 'text-warning',
  danger: 'text-destructive',
}

const noSubscribe = () => () => {}
const storageKey = (workspaceId: string, kind: string) =>
  `helvetly:plan-notice:${workspaceId}:${kind}`

function readHidden(key: string) {
  try {
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/** Hidden for the rest of the browser session, per workspace and state. */
function useHidden(key: string) {
  const stored = useSyncExternalStore(
    noSubscribe,
    () => readHidden(key),
    () => false,
  )
  const [hiddenNow, setHiddenNow] = useState<string | null>(null)
  const hide = () => {
    setHiddenNow(key)
    try {
      window.sessionStorage.setItem(key, '1')
    } catch {
      // Private mode: hidden until the page reloads.
    }
  }
  return [stored || hiddenNow === key, hide] as const
}

/**
 * The plan's state above the user button: the trial's countdown with the way to a plan, a failed
 * payment, a disputed payment, a plan that ends, or a read-only workspace. Collapsed, the sidebar keeps only its icon.
 */
export function SidebarPlanNotice({
  billing,
  workspaceId,
  onGo,
}: {
  billing: Billing | undefined
  workspaceId: string
  onGo?: () => void
}) {
  const notice = planNotice(billing)
  const [hidden, hide] = useHidden(storageKey(workspaceId, notice?.kind ?? 'none'))
  if (!notice || (notice.dismissable && hidden)) return null
  const Icon = ICONS[notice.kind]

  return (
    <>
      <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild={Boolean(notice.action)}
            tooltip={notice.action ? `${notice.title}: ${notice.action.label}` : notice.title}
            className={cn('[&_svg]:size-[18px]!', INK[notice.tone])}
            data-testid="plan-notice-icon"
          >
            {notice.action ? (
              <Link href={notice.action.href} onClick={onGo}>
                <Icon /> <span>{notice.title}</span>
              </Link>
            ) : (
              <>
                <Icon /> <span>{notice.title}</span>
              </>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <section
        aria-label={translate('plan')}
        data-testid="plan-notice"
        data-kind={notice.kind}
        className={cn(
          'grid gap-2.5 rounded-xl border p-3 group-data-[collapsible=icon]:hidden',
          CARD[notice.tone],
        )}
      >
        <div className="flex items-start gap-2">
          <Icon className={cn('mt-px size-4 shrink-0', INK[notice.tone])} aria-hidden />
          <p className="min-w-0 flex-1 text-body-sm font-medium text-foreground">{notice.title}</p>
          {notice.dismissable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="-mt-1 -mr-1 text-muted-foreground"
                  aria-label={translate('hideForThisSession')}
                  onClick={hide}
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translate('hideForThisSession')}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {notice.progress && (
          <Meter
            value={notice.progress.left}
            max={notice.progress.of}
            tone="brand"
            label={translate('trialDaysLeft')}
          />
        )}
        <p className="text-caption text-pretty text-muted-foreground">{notice.text}</p>
        {notice.action && (
          <Button
            asChild
            size="sm"
            variant={notice.tone === 'brand' ? 'default' : 'outline'}
            className="w-full"
          >
            <Link href={notice.action.href} onClick={onGo}>
              {notice.action.label}
            </Link>
          </Button>
        )}
      </section>
    </>
  )
}

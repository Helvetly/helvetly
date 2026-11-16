'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { errorMessage } from '@/lib/api'
import {
  formatReset,
  limitReached,
  planRefusal,
  usageLabel,
  type LimitReached,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'
import { refusedScope } from '@/lib/permissions'

import { UsageMeter } from './usage-meter'

// One prompt for the whole app: a create that hits the plan's limit opens it (Providers' MutationCache).
let current: (LimitReached & { message: string }) | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Opens the upgrade prompt when the error is a plan limit; reports whether it did. */
export function promptUpgrade(error: unknown): boolean {
  const limit = limitReached(error)
  if (!limit) return false
  current = { ...limit, message: errorMessage(error) }
  emit()
  return true
}

/** toast.error for a failed action, unless the upgrade prompt, the plan toast or the permission toast already explains it. */
export function toastError(error: unknown) {
  if (!limitReached(error) && !planRefusal(error) && !refusedScope(error))
    toast.error(errorMessage(error))
}

const close = () => {
  current = null
  emit()
}

const TITLES: Record<string, string> = {
  members: translate('memberLimitReached'),
  clients: translate('clientLimitReached'),
  invoices_per_month: translate('monthlyInvoiceLimitReached'),
  expenses_per_month: translate('monthlyExpenseLimitReached'),
  products: translate('catalogueLimitReached'),
  engagements: translate('engagementLimitReached'),
  signatures_per_month: translate('monthlySignatureLimitReached'),
  storage_bytes: translate('storageIsFull'),
  ai_tokens_per_month: translate('monthlyAIAllowanceUsed'),
  automation_actions_per_month: translate('monthlyAutomationActionsUsed'),
  emails_per_month: translate('monthlyEmailAllowanceUsed'),
  email_attachment_bytes_per_month: translate('monthlyAttachmentAllowanceUsed'),
  download_bytes_per_month: translate('monthlyDownloadAllowanceUsed'),
}

export function UpgradePrompt() {
  const limit = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
  if (!limit) return null
  const label = usageLabel(limit.limit)
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(400px,calc(100vw-2rem))] max-w-none! gap-0 rounded-2xl p-6"
      >
        <span
          aria-hidden
          className="flex size-11 items-center justify-center rounded-full bg-heidi-soft text-heidi-ink ring-8 ring-heidi-soft/40 dark:bg-heidi/20 dark:text-heidi-soft dark:ring-heidi/5"
        >
          <Sparkles className="size-5 stroke-[1.75]" />
        </span>
        <DialogTitle className="mt-5 text-[17px] font-medium tracking-[-0.01em]">
          {TITLES[limit.limit] ?? translate('planLimitReached')}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-[14px] leading-relaxed text-pretty">
          {limit.message}
          {limit.limit === 'invoices_per_month' &&
            ` ${translate('yourDraftIsSavedAndCanBeIssued')}`}
          {limit.reset_at &&
            ` ${translate('theAllowanceResetsOn', { at: formatReset(limit.reset_at) })}`}
        </DialogDescription>
        <UsageMeter
          className="mt-5"
          item={{ limit: limit.limit, used: limit.used, max: limit.max }}
          label={label}
        />
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button variant="outline" size="xl" onClick={close}>
            {translate('notNow')}
          </Button>
          <Button asChild size="xl" onClick={close}>
            <Link href="/settings/billing/plans">{translate('seePlans')}</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

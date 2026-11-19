'use client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'

import type { Engagement } from '@/lib/engagements'
import { translate } from '@/lib/i18n'

import { QuickLog } from './entry-log'

/** The detail's "Log delivery" form from a list row, without opening the engagement; it closes once logged. */
export function LogDeliveryDialog({
  engagement,
  onClose,
}: {
  engagement: Engagement
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(520px,calc(100vw-2rem))] max-w-none! gap-0 rounded-2xl p-0">
        <div className="grid gap-1 px-6 pt-6">
          <DialogTitle className="text-title-sm font-medium">
            {translate('logDelivery')}
          </DialogTitle>
          <DialogDescription className="truncate">
            {engagement.title} · #{engagement.number} · {engagement.client.name}
          </DialogDescription>
        </div>
        <div className="px-6 pt-5 pb-6">
          <QuickLog
            engagementId={engagement.id}
            unit={engagement.unit}
            current={engagement.current_period}
            onLogged={onClose}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

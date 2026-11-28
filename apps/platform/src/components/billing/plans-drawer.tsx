'use client'
import { Loader } from '@helvetly/ui/components/loader'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@helvetly/ui/components/sheet'

import { errorMessage } from '@/lib/api'
import { useBilling, usePublicOffer } from '@/lib/billing'
import { translate } from '@/lib/i18n'

import { PlanCards } from './plan-cards'

/**
 * The plans to choose from, in a drawer over the current screen. The plans page is outside the welcome (it sends
 * anyone who has not finished it back to the first step), so a screen on the welcome opens this instead.
 */
export function PlansDrawer({ onClose }: { onClose: () => void }) {
  const billing = useBilling()
  const offer = usePublicOffer()
  const error = billing.error ?? offer.error
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle>{translate('chooseAPlan')}</SheetTitle>
          <SheetDescription className="sr-only">{translate('plans')}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {error ? (
            <p role="alert" className="text-sm text-muted-foreground">
              {translate('plansCouldnTBeLoaded')}
              {errorMessage(error)}
            </p>
          ) : !billing.data || !offer.data ? (
            <Loader label={translate('loadingPlans')} className="min-h-96" />
          ) : (
            <PlanCards billing={billing.data} offer={offer.data} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

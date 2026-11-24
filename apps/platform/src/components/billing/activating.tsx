'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Loader } from '@helvetly/ui/components/loader'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { toastError } from '@/components/billing/upgrade-prompt'
import { PlanScreen } from '@/components/shell/plan-gate'
import { isPaid, useBilling, useSyncBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'

export const ACTIVATING_PATH = '/activating'

/** Whether `pathname` is the page after Checkout (the static export serves it as /activating/). */
export const isActivating = (pathname: string) => pathname.replace(/\/$/, '') === ACTIVATING_PATH

const POLL_MS = 2_000

/**
 * Where Stripe's Checkout comes back to once paid: the subscription is read from Stripe once, then
 * billing again every two seconds until the workspace opens, and the app follows (the welcome first
 * for a new owner, through OnboardingRedirect). After `slowAfter` it stops waiting and says so.
 */
export function Activating({ slowAfter = 60_000 }: { slowAfter?: number }) {
  const router = useRouter()
  const sync = useSyncBilling()
  const [slow, setSlow] = useState(false)
  const billing = useBilling(slow ? false : POLL_MS)
  const data = billing.data
  // Self-hosted (billing off) or the paid plan is in: nothing to wait for. Until then the workspace is on Free.
  const open = Boolean(data && (!data.enabled || isPaid(data.plan)))
  const synced = useRef(false)

  useEffect(() => {
    if (open) router.replace('/')
  }, [open, router])

  useEffect(() => {
    if (synced.current) return
    synced.current = true
    sync.mutate(undefined, { onError: toastError })
  }, [sync])

  useEffect(() => {
    if (slow) return
    const timer = setTimeout(() => setSlow(true), slowAfter)
    return () => clearTimeout(timer)
  }, [slow, slowAfter])

  const checkAgain = () => {
    setSlow(false)
    sync.mutate(undefined, { onError: toastError })
  }

  return (
    <PlanScreen action={null}>
      <div className="mt-8 grid w-full max-w-md justify-items-center gap-4 text-center md:mt-16">
        {slow ? (
          <>
            <Callout tone="info" className="w-full text-left">
              {translate('yourPaymentWentThroughThePlanCanTakeAMinute')}
            </Callout>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={checkAgain}>
                {translate('checkAgain')}
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/settings/billing">{translate('goToBilling')}</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <Loader label={translate('activatingYourPlan')} className="min-h-12" />
            <h1 className="text-page font-medium tracking-[-0.02em]">
              {translate('activatingYourPlan')}
            </h1>
            <p className="text-body text-pretty text-muted-foreground">
              {translate('paymentReceivedThisTakesAFewSeconds')}
            </p>
          </>
        )}
      </div>
    </PlanScreen>
  )
}

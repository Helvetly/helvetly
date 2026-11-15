'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { capitalize, formatDate } from '@helvetly/ui/lib/format'
import { Download, Receipt } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { SettingsPage } from '@/components/settings/layout'
import { SettingsHeader } from '@/components/settings/settings-tabs'
import { errorMessage } from '@/lib/api'
import {
  formatPrice,
  taxNoteLong,
  useBilling,
  useBillingDetails,
  usePortal,
  useSyncBilling,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

import { AITokenPacks } from './ai-token-packs'
import { BillingCard } from './billing-card'
import { PaymentCard } from './card-brand'
import { PlanSummary } from './plan-summary'
import { UsageOverview } from './usage-overview'

/**
 * Plan & billing: a full-width overview. The plan as a hero (its total, the ways to change it and a
 * countdown to what comes next), then usage as tiles closest to the limit first, then the card and
 * Helvetly's invoices side by side on a wide panel.
 */
export function BillingSettings() {
  const billing = useBilling()
  const portal = usePortal()
  const openingPortal = useRef(false)
  useCheckoutReturn()
  const data = billing.data
  const openPortal = () => {
    if (openingPortal.current) return
    openingPortal.current = true
    portal.mutate(undefined, {
      onSuccess: ({ url }) => window.location.assign(url),
      onError: toastError,
      onSettled: () => {
        openingPortal.current = false
      },
    })
  }
  const payments = data?.has_customer && data.can_manage

  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title={translate('planBilling')}
        description={translate('thisWorkspaceSPlanWhatItUsesOfIt')}
      >
        {billing.error ? (
          <p role="alert" className="text-sm text-muted-foreground">
            {translate('billingCouldnTBeLoaded')}
            {errorMessage(billing.error)}
          </p>
        ) : !data ? (
          <Loader label={translate('loadingBilling')} className="min-h-80" />
        ) : (
          <div data-slot="billing-overview" className="@container grid gap-7">
            {!data.enabled && (
              <p className="rounded-lg bg-warning-surface px-4 py-3 text-body-sm text-pretty text-warning">
                {translate('subscriptionBillingIsCurrentlyUnavailablePlanLimitsAreNot')}
              </p>
            )}
            <PlanSummary billing={data} onPortal={openPortal} portalPending={portal.isPending} />
            {/* Without a plan there are no limits to measure against ("0 of unlimited" misleads). */}
            {data.plan !== '' && data.usage.length > 0 && <UsageOverview billing={data} />}
            <AITokenPacks billing={data} />
            {payments && (
              <div className="grid gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <PaymentMethod
                  currency={data.currency}
                  onPortal={openPortal}
                  portalPending={portal.isPending}
                />
                <Invoices />
              </div>
            )}
          </div>
        )}
      </SettingsPage>
    </>
  )
}

/** Back from Checkout (?checkout=success|canceled|ai_tokens): read the subscription now, then tidy the URL. */
function useCheckoutReturn() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const sync = useSyncBilling()
  const handled = useRef(false)
  const outcome = params.get('checkout')

  useEffect(() => {
    if (!outcome || handled.current) return
    handled.current = true
    router.replace(pathname)
    if (outcome === 'canceled') {
      toast(translate('checkoutCancelledNothingWasCharged'))
      return
    }
    if (outcome === 'ai_tokens') {
      toast.success(translate('paymentReceivedTheAITokensAreAddedInA'))
      return
    }
    sync.mutate(undefined, {
      onSuccess: (billing) =>
        toast.success(
          billing.plan === ''
            ? translate('paymentReceivedThePlanAppearsHereInAMoment')
            : translate('welcomeTo', { value1: capitalize(billing.plan) }),
        ),
      onError: toastError,
    })
  }, [outcome, pathname, router, sync])
}

/** The card Stripe charges, drawn as a card, and the way to change it in Stripe's portal. */
function PaymentMethod({
  currency,
  onPortal,
  portalPending,
}: {
  currency: string
  onPortal: () => void
  portalPending: boolean
}) {
  const details = useBillingDetails(true)
  const card = details.data?.payment_method ?? null
  return (
    <BillingCard
      id="payment-method"
      title={translate('paymentMethod')}
      description={translate('theCardStripeCharges')}
      action={
        !details.isPending && (
          <Button size="sm" variant="outline" disabled={portalPending} onClick={onPortal}>
            {card ? 'Update' : 'Add card'}
          </Button>
        )
      }
    >
      <div className="grid flex-1 place-items-center px-5 py-5">
        {details.isPending ? (
          <Loader label={translate('loadingTheCard')} className="min-h-40" />
        ) : (
          <PaymentCard card={card} />
        )}
      </div>
      <p className="border-t px-5 py-3 text-body-sm text-pretty text-muted-foreground">
        {translate('billingChargeNotice', { currency: currency.toUpperCase(), taxNote: taxNoteLong(currency) })}
      </p>
    </BillingCard>
  )
}

const INVOICE_TONES: Record<string, Tone> = {
  paid: 'green',
  open: 'amber',
  draft: 'gray',
  void: 'gray',
  uncollectible: 'red',
}

/** Helvetly's invoices to the workspace: date, number, amount, status and the PDF. */
function Invoices() {
  const details = useBillingDetails(true)
  const invoices = details.data?.invoices
  return (
    <BillingCard
      id="billing-invoices"
      title={translate('invoices')}
      description={translate('helvetlySInvoicesToThisWorkspace')}
    >
      {details.isPending ? (
        <Loader label={translate('loadingInvoices')} className="min-h-28" />
      ) : details.error ? (
        <p role="alert" className="px-5 py-4 text-body-sm text-muted-foreground">
          {translate('invoicesCouldnTBeLoaded')}
          {errorMessage(details.error)}
        </p>
      ) : !invoices || invoices.length === 0 ? (
        <div className="grid justify-items-center gap-2 px-5 py-8 text-center">
          <Receipt aria-hidden className="size-5 text-muted-foreground" />
          <p className="text-body font-medium">{translate('noInvoicesYet')}</p>
          <p className="max-w-xs text-body-sm text-pretty text-muted-foreground">
            {translate('theFirstArrivesWhenTheTrialOrTheFirst')}
          </p>
        </div>
      ) : (
        <table className="w-full text-body">
          <thead className="text-left text-caption text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pl-5 font-medium">{translate('date')}</th>
              <th className="hidden py-2 pl-4 font-medium @md:table-cell">{translate('number')}</th>
              <th className="py-2 pl-4 text-right font-medium">{translate('amount')}</th>
              <th className="py-2 pl-4 font-medium @sm:pl-6">{translate('status')}</th>
              <th className="w-12 py-2 pr-3">
                <span className="sr-only">{translate('download')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => {
              const number = invoice.number || invoice.id
              return (
                <tr key={invoice.id} className="border-b last:border-0">
                  <td className="py-2.5 pl-5">
                    <span className="grid">
                      <span className="whitespace-nowrap">{formatDate(invoice.date)}</span>
                      {/* The number moves under the date on a narrow card. */}
                      <a
                        href={localizedHref(invoice.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-body-sm text-muted-foreground underline underline-offset-2 hover:no-underline @md:hidden"
                      >
                        {number}
                      </a>
                    </span>
                  </td>
                  <td className="hidden py-2.5 pl-4 @md:table-cell">
                    <a
                      href={localizedHref(invoice.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground underline underline-offset-2 hover:text-foreground hover:no-underline"
                    >
                      {number}
                    </a>
                  </td>
                  <td className="py-2.5 pl-4 text-right whitespace-nowrap tabular-nums">
                    {formatPrice({ amount: invoice.total, currency: invoice.currency })}
                  </td>
                  <td className="py-2.5 pl-4 @sm:pl-6">
                    <StatusBadge tone={INVOICE_TONES[invoice.status] ?? 'gray'}>
                      {capitalize(invoice.status)}
                    </StatusBadge>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {invoice.pdf && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild size="icon-sm" variant="ghost">
                            <a
                              href={localizedHref(invoice.pdf)}
                              aria-label={translate('downloadAsPDF', { number: number })}
                            >
                              <Download aria-hidden />
                            </a>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{translate('downloadPDF')}</TooltipContent>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </BillingCard>
  )
}

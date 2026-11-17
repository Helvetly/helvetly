'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { capitalize, formatDate } from '@helvetly/ui/lib/format'
import { CreditCard, Download, Receipt } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { LoadError } from '@/components/load-error'
import {
  SettingsNotice,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '@/components/settings/layout'
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
import { PlanSummary } from './plan-summary'
import { UsageOverview } from './usage-overview'

/**
 * Plan & billing, laid out like the account page: sections for the plan (its total, the ways to
 * change it, what comes next), the usage as a compact list, the card and Helvetly's invoices.
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
          <>
            {!data.enabled && (
              <SettingsNotice>
                <p className="rounded-lg bg-warning-surface px-4 py-3 text-body-sm text-pretty text-warning">
                  {translate('subscriptionBillingIsCurrentlyUnavailablePlanLimitsAreNot')}
                </p>
              </SettingsNotice>
            )}
            <PlanSummary billing={data} onPortal={openPortal} portalPending={portal.isPending} />
            {payments && (
              <PaymentMethod
                currency={data.currency}
                onPortal={openPortal}
                portalPending={portal.isPending}
              />
            )}
            {/* Without a plan there are no limits to measure against ("0 of unlimited" misleads). */}
            {data.plan !== '' && data.usage.length > 0 && <UsageOverview billing={data} />}
            {/* Only while packs bought earlier still count this month. */}
            <AITokenPacks billing={data} />
            {payments && <Invoices />}
          </>
        )}
      </SettingsPage>
    </>
  )
}

/** Back from a plan change (?checkout=switched|scheduled|canceled): read the subscription now, then
 * tidy the URL. A first Checkout comes back to /activating instead. */
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
    sync.mutate(undefined, {
      onSuccess: (billing) =>
        toast.success(
          outcome === 'scheduled'
            ? translate('yourPlanChangesAtTheEndOfThePaidPeriod')
            : translate('welcomeTo', { value1: capitalize(billing.plan) }),
        ),
      onError: toastError,
    })
  }, [outcome, pathname, router, sync])
}

/** The card Stripe charges as one row, and the way to change it in Stripe's portal. */
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
    <SettingsSection
      id="payment-method"
      icon={CreditCard}
      title={translate('paymentMethod')}
      description={translate('theCardStripeCharges')}
    >
      <div className="grid gap-3">
        {details.isPending ? (
          <Loader label={translate('loadingTheCard')} className="min-h-14" />
        ) : details.error ? (
          <LoadError
            what={translate('paymentMethod')}
            error={details.error}
            onRetry={() => details.refetch()}
          />
        ) : (
          <ul className="grid">
            <SettingsRow
              icon={<CreditCard />}
              title={
                card
                  ? `${card.brand === 'amex' ? translate('americanExpress') : capitalize(card.brand)} •••• ${card.last4}`
                  : translate('noCardOnFile')
              }
              meta={
                card
                  ? `${translate('expires2')}${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}`
                  : translate('addACardToKeepTheSubscriptionRunning')
              }
            >
              <Button size="sm" variant="outline" disabled={portalPending} onClick={onPortal}>
                {card ? translate('updateCard') : translate('addCard')}
              </Button>
            </SettingsRow>
          </ul>
        )}
        <p className="text-body-sm text-pretty text-muted-foreground">
          {translate('billingChargeNotice', {
            currency: currency.toUpperCase(),
            taxNote: taxNoteLong(currency),
          })}
        </p>
      </div>
    </SettingsSection>
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
    <SettingsSection
      id="billing-invoices"
      icon={Receipt}
      title={translate('invoices')}
      description={translate('helvetlySInvoicesToThisWorkspace')}
    >
      {details.isPending ? (
        <Loader label={translate('loadingInvoices')} className="min-h-28" />
      ) : details.error ? (
        <p role="alert" className="text-body-sm text-muted-foreground">
          {translate('invoicesCouldnTBeLoaded')}
          {errorMessage(details.error)}
        </p>
      ) : !invoices || invoices.length === 0 ? (
        <div className="grid gap-0.5">
          <p className="text-body font-medium">{translate('noInvoicesYet')}</p>
          <p className="max-w-[68ch] text-body-sm text-pretty text-muted-foreground">
            {translate('theFirstArrivesWhenTheTrialOrTheFirst')}
          </p>
        </div>
      ) : (
        // In a div, so the table keeps to the settings form grid's width like the usage list above.
        <div>
          <table className="w-full text-body">
            <thead className="text-left text-caption text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">{translate('date')}</th>
                <th className="hidden py-2 pl-4 font-medium @md:table-cell">
                  {translate('number')}
                </th>
                <th className="py-2 pl-4 text-right font-medium">{translate('amount')}</th>
                <th className="py-2 pl-4 font-medium @sm:pl-6">{translate('status')}</th>
                <th className="w-12 py-2">
                  <span className="sr-only">{translate('download')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const number = invoice.number || invoice.id
                return (
                  <tr key={invoice.id} className="border-b last:border-0">
                    <td className="py-2.5">
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
                    <td className="py-2 text-right">
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
        </div>
      )}
    </SettingsSection>
  )
}

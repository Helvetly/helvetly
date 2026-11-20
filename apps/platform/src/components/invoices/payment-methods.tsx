'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Check, Copy, Plus, QrCode, Smartphone, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'
import {
  qrBillBlocker,
  revolutBlocker,
  type Invoice,
  type InvoiceSettings,
  type PaymentMethods,
} from '@/lib/invoices'

type Method = { key: keyof PaymentMethods; label: string; tip: string; blocker: string | null }

export const METHOD_ICONS: Record<keyof PaymentMethods, LucideIcon> = {
  qr_bill: QrCode,
  revolut: Smartphone,
}

/**
 * The invoice's payment methods as independent checkbox chips. One not set up in the settings shows as a
 * link to set it up, so it can be discovered; one that cannot apply (no IBAN, a currency without
 * QR bill) is off with the reason.
 */
export function PaymentToggles({
  settings,
  currency,
  value,
  onChange,
}: {
  settings: InvoiceSettings
  currency: string
  value: PaymentMethods
  onChange: (value: PaymentMethods) => void
}) {
  const methods: Method[] = []
  const setup: { key: keyof PaymentMethods; label: string; tip: string }[] = []
  const qrBill = {
    key: 'qr_bill' as const,
    label: translate('qrBill'),
    tip: translate('attachASwissQRBillPageTheClientScans'),
  }
  const revolut = {
    key: 'revolut' as const,
    label: translate('revolut2'),
    tip: translate('printPayWithRevolutWithAQRCodeOf', { value1: settings.revolut_username ?? '' }),
  }
  if (settings.qr_bill_enabled)
    methods.push({ ...qrBill, blocker: qrBillBlocker(settings, currency) })
  else
    setup.push({
      ...qrBill,
      tip: 'Turn on the Swiss QR bill in the invoice settings to offer it.',
    })
  if (settings.revolut_enabled) methods.push({ ...revolut, blocker: revolutBlocker(settings) })
  else
    setup.push({
      ...revolut,
      tip: 'Add your Revolut username in the invoice settings to let clients pay with Revolut.',
    })

  return (
    // Checkbox chips, not a segmented control: each method is on or off on its own, and both can be.
    <fieldset className="flex items-center gap-1.5 sm:flex-wrap">
      <legend className="sr-only">{translate('paymentMethods')}</legend>
      <span aria-hidden className="pr-0.5 text-caption text-muted-foreground max-sm:hidden">
        {translate('payment')}
      </span>
      {methods.map((method) => {
        const on = value[method.key] && !method.blocker
        const Icon = METHOD_ICONS[method.key]
        return (
          <Tooltip key={method.key}>
            <TooltipTrigger asChild>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card pr-3 pl-2 text-body-sm text-muted-foreground transition-colors duration-150 hover:border-foreground/20 hover:text-foreground has-checked:border-brand-solid/45 has-checked:bg-brand-surface/40 has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50 has-disabled:hover:border-border has-disabled:hover:text-muted-foreground">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={Boolean(method.blocker)}
                  onChange={(event) => onChange({ ...value, [method.key]: event.target.checked })}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className="flex size-4 items-center justify-center rounded-[5px] border border-input bg-background text-transparent transition-colors duration-150 peer-checked:border-brand-solid peer-checked:bg-brand-solid peer-checked:text-background"
                >
                  <Check className="size-3 stroke-[2.5]" />
                </span>
                <Icon aria-hidden className="size-3.5 stroke-[1.5]" />
                {method.label}
              </label>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{method.blocker ?? method.tip}</TooltipContent>
          </Tooltip>
        )
      })}
      {setup.map((method) => {
        const Icon = METHOD_ICONS[method.key]
        return (
          <Tooltip key={method.key}>
            <TooltipTrigger asChild>
              <Link
                href={`/settings/invoices?focus=${method.key}_enabled`}
                className="flex h-8 items-center gap-2 rounded-lg border border-dashed border-border pr-3 pl-2 text-body-sm text-muted-foreground transition-colors duration-150 hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Plus aria-hidden className="size-4 stroke-[1.5]" />
                <Icon aria-hidden className="size-3.5 stroke-[1.5]" />
                {method.label}
              </Link>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{method.tip}</TooltipContent>
          </Tooltip>
        )
      })}
    </fieldset>
  )
}

/** Small marks in a list row for the methods an invoice offers; nothing for plain bank details. */
export function PaymentMarks({ methods }: { methods: PaymentMethods }) {
  const marks = [
    methods.qr_bill && { key: 'qr', label: translate('swissQRBill'), icon: <QrCode /> },
    methods.revolut && { key: 'revolut', label: translate('revolut2'), icon: <Smartphone /> },
  ].filter((mark) => mark !== false)
  if (marks.length === 0) return null
  return (
    <span className="flex items-center gap-1 text-muted-foreground/70 [&_svg]:size-3">
      {marks.map((mark) => (
        <Tooltip key={mark.key}>
          <TooltipTrigger asChild>
            <span>
              {mark.icon}
              <span className="sr-only">{mark.label}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{mark.label}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  )
}

/** Bank details always; the QR bill and the Revolut link (frozen on issue, copyable) when offered. */
export function PaymentSummary({ payment }: { payment: Invoice['payment'] }) {
  const parts = [payment.qr_bill && 'Swiss QR bill', payment.revolut_url && 'Revolut'].filter(
    Boolean,
  )
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">
        {parts.length ? parts.join(' · ') : translate('bankTransferOnly')}
      </span>
      {payment.revolut_url && (
        <>
          <a
            href={localizedHref(payment.revolut_url)}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground hover:no-underline"
          >
            {payment.revolut_url.replace('https://', '')}
          </a>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={translate('copyTheRevolutLink')}
            className="shrink-0 text-muted-foreground"
            onClick={() => {
              const link = payment.revolut_url ?? ''
              void navigator.clipboard.writeText(link).then(
                () => toast.success(translate('revolutLinkCopied')),
                () => toast.error(translate('couldnTCopyTheLink')),
              )
            }}
          >
            <Copy className="size-3.5" />
          </Button>
        </>
      )}
    </span>
  )
}

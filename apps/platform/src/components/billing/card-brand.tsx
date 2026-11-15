import { cn } from '@helvetly/ui/lib/utils'
import { CreditCard } from 'lucide-react'

import { translate } from '@/lib/i18n'

/**
 * A card's brand as a small mark on a card-shaped tile: a wordmark for Visa and American Express,
 * the two circles for Mastercard, a card icon for anything else (or no card). Drawn with tokens, so
 * it reads in light and dark.
 */
export function CardBrand({ brand, className }: { brand: string | null; className?: string }) {
  return (
    <span
      data-slot="card-brand"
      data-brand={brand ?? 'none'}
      aria-hidden
      className={cn(
        'grid h-8 w-12 shrink-0 place-items-center rounded-md bg-card ring-1 ring-border ring-inset',
        !brand && 'border border-dashed ring-0',
        className,
      )}
    >
      <Mark brand={brand} />
    </span>
  )
}

function Mark({ brand }: { brand: string | null }) {
  switch (brand) {
    case 'visa':
      return (
        <span className="text-body-sm font-extrabold tracking-[-0.02em] text-info italic">
          VISA
        </span>
      )
    case 'mastercard':
      return (
        <span className="flex">
          <span className="size-4 rounded-full bg-destructive" />
          <span className="-ml-1.5 size-4 rounded-full bg-warning-solid opacity-90" />
        </span>
      )
    case 'amex':
      return (
        <span className="rounded-[3px] bg-info px-1 text-caption font-bold tracking-tight text-background">
          AMEX
        </span>
      )
    default:
      return <CreditCard className="size-4 text-muted-foreground" />
  }
}

/**
 * The card on file drawn as a small payment card: the brand's mark, the last four digits and the
 * expiry. Inverted in light mode (a dark card on the page), a raised surface in dark mode. Without a
 * card, a dashed outline of one.
 */
export function PaymentCard({
  card,
  className,
}: {
  card: { brand: string; last4: string; exp_month: number; exp_year: number } | null
  className?: string
}) {
  const shape = 'relative aspect-[1.586] w-full max-w-64 rounded-xl'
  if (!card)
    return (
      <div
        data-slot="payment-card"
        data-brand="none"
        className={cn(
          shape,
          'grid place-items-center border border-dashed text-body-sm text-muted-foreground',
          className,
        )}
      >
        <span className="flex items-center gap-2">
          <CreditCard aria-hidden className="size-4" />
          {translate('noCardOnFile')}
        </span>
      </div>
    )
  const expiry = `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}`
  return (
    <div
      data-slot="payment-card"
      data-brand={card.brand}
      className={cn(
        shape,
        'flex flex-col justify-between bg-foreground p-4 text-background shadow-elevation-2 dark:bg-muted dark:text-foreground dark:ring-1 dark:ring-border dark:ring-inset',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        {/* The chip. */}
        <span aria-hidden className="h-6 w-8 rounded-md bg-current opacity-20" />
        <CardBrand brand={card.brand} className="h-7 w-11 bg-background ring-0" />
      </div>
      <div className="grid gap-1.5">
        <p className="font-mono text-title-sm tracking-[0.18em] tabular-nums">
          <span aria-hidden>•••• •••• •••• </span>
          <span className="sr-only">{translate('cardEndingIn')}</span>
          {card.last4}
        </p>
        <p className="flex justify-between text-caption opacity-70">
          <span>
            {card.brand === 'amex'
              ? translate('americanExpress')
              : card.brand.replace(/^./, (c) => c.toUpperCase())}
          </span>
          <span className="tabular-nums">
            <span className="sr-only">{translate('expires2')}</span>
            {expiry}
          </span>
        </p>
      </div>
    </div>
  )
}

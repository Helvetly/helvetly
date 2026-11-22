'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { errorMessage } from '@/lib/api'
import { describeDiscount, usePromotionCode, type Promotion } from '@/lib/billing'
import { translate } from '@/lib/i18n'

/**
 * Checks a promotion code with the API; the plan cards then show its price. The field opens over the page beside
 * its link (`children`), so the cards never move.
 */
export function PromoCodePopover({
  initial,
  onApplied,
  children,
}: {
  initial: string
  onApplied: (promotion: Promotion) => void
  children: ReactNode
}) {
  const check = usePromotionCode()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState(initial)
  const [error, setError] = useState('')

  const show = (next: boolean) => {
    if (check.isPending) return
    if (next) {
      setCode(initial)
      setError('')
    }
    setOpen(next)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return setError(translate('enterAPromotionCode'))
    check.mutate(trimmed, {
      onSuccess: (promotion) => {
        onApplied(promotion)
        setOpen(false)
      },
      // the API says why: not valid, another currency, another plan, a discount already running
      onError: (err) => setError(errorMessage(err)),
    })
  }

  return (
    <Popover open={open} onOpenChange={show}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 gap-4 p-4 text-left">
        <PopoverHeader>
          <PopoverTitle>{translate('promotionCode')}</PopoverTitle>
          <PopoverDescription>
            {translate('theDiscountShowsOnThePlansItCoversAnd')}
          </PopoverDescription>
        </PopoverHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <FormField id="promotion-code" required label={translate('code')} error={error}>
            <Input
              {...describedBy('promotion-code', error)}
              autoComplete="off"
              maxLength={40}
              placeholder={translate('launch20')}
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
                setError('')
              }}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => show(false)}
              disabled={check.isPending}
            >
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={check.isPending}>
              {check.isPending ? translate('checking') : translate('apply')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

// Calm focus like every button (a ring that never moves the line), not the browser's box around the text.
const textLink =
  'rounded-sm underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * The one entry point for a promotion code, under the billing-period switch: a link that opens the code popover,
 * or, once a code is applied, its chip with change and remove. One line high either way, so nothing below moves.
 */
export function PromoCodeEntry({
  promo,
  onChange,
}: {
  promo: Promotion | null
  onChange: (promotion: Promotion | null) => void
}) {
  return (
    <div className="flex min-h-6 items-center gap-2 text-body-sm text-muted-foreground">
      {promo ? (
        <>
          <Badge tone="blue" size="sm">
            <span className="font-code">{promo.code}</span> · {describeDiscount(promo)}
          </Badge>
          <PromoCodePopover initial={promo.code} onApplied={onChange}>
            <button type="button" className={textLink}>
              {translate('change')}
            </button>
          </PromoCodePopover>
          <button
            type="button"
            className={cn(textLink, 'inline-flex items-center gap-1 text-destructive')}
            onClick={() => onChange(null)}
          >
            <X className="size-3.5" aria-hidden />
            {translate('remove')}
          </button>
        </>
      ) : (
        <PromoCodePopover initial="" onApplied={onChange}>
          <button type="button" className={textLink}>
            {translate('haveAPromotionCode')}
          </button>
        </PromoCodePopover>
      )}
    </div>
  )
}

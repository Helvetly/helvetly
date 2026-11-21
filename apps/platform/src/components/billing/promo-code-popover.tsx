'use client'
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
import { useState, type FormEvent, type ReactNode } from 'react'

import { errorMessage } from '@/lib/api'
import { usePromotionCode, type Promotion } from '@/lib/billing'
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

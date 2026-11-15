'use client'

import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { useState, type FormEvent } from 'react'

import { ApiError, errorMessage } from '@/lib/api'
import { usePromotionCode, type Promotion } from '@/lib/billing'

/** Checks a promotion code with the API; the plan cards then show its price. */
export function PromoCodeDialog({
  initial,
  onApplied,
  onClose,
}: {
  initial: string
  onApplied: (promotion: Promotion) => void
  onClose: () => void
}) {
  const check = usePromotionCode()
  const [code, setCode] = useState(initial)
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return setError('Enter a promotion code.')
    check.mutate(trimmed, {
      onSuccess: (promotion) => {
        onApplied(promotion)
        onClose()
      },
      onError: (err) =>
        setError(
          err instanceof ApiError && err.code === 'promotion_code_invalid'
            ? "This code isn't valid."
            : errorMessage(err),
        ),
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !check.isPending && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Promotion code</DialogTitle>
          <DialogDescription>
            The discount shows on the plans it covers and applies at checkout.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <FormField id="promotion-code" required label="Code" error={error}>
            <Input
              {...describedBy('promotion-code', error)}
              autoComplete="off"
              maxLength={40}
              placeholder="LAUNCH20"
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
                setError('')
              }}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={check.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={check.isPending}>
              {check.isPending ? 'Checking…' : 'Apply'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

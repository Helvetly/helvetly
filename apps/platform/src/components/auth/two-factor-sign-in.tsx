'use client'

import { Button } from '@helvetly/ui/components/button'
import { Field, FieldError, FieldLabel } from '@helvetly/ui/components/field'
import { Input } from '@helvetly/ui/components/input'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, errorMessage, type SignedIn } from '@/lib/api'

export function TwoFactorSignIn({
  challengeId,
  onDone,
  onBack,
}: {
  challengeId: string
  onDone: (result: SignedIn) => void
  onBack: () => void
}) {
  const [code, setCode] = useState('')
  const [validation, setValidation] = useState('')
  const check = useMutation({
    mutationFn: () =>
      api.verifyTwoFactor({ challenge_id: challengeId, code: code.trim().toLowerCase() }),
    onSuccess: (result) => onDone(result),
    onError: () => setCode(''),
  })
  return (
    <div className="grid gap-6">
      <div className="grid gap-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Two-factor authentication</h1>
        <p className="text-sm text-muted-foreground">
          Enter a code from your authenticator app or one of your unused recovery codes.
        </p>
      </div>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (check.isPending) return
          if (!/^(?:\d{6}|[a-z2-7]{5}-[a-z2-7]{5})$/i.test(code.trim())) {
            setValidation('Enter a 6-digit code or a recovery code in xxxxx-xxxxx format.')
            return
          }
          setValidation('')
          check.mutate()
        }}
      >
        <Field data-invalid={!!validation || check.isError}>
          <FieldLabel htmlFor="two-factor-code">Authenticator or recovery code</FieldLabel>
          <Input
            id="two-factor-code"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            value={code}
            maxLength={11}
            aria-invalid={!!validation || check.isError}
            onChange={(event) => setCode(event.target.value)}
          />
          <FieldError>{validation || (check.error ? errorMessage(check.error) : '')}</FieldError>
        </Field>
        <Button type="submit" size="xl" disabled={check.isPending}>
          {check.isPending ? 'Checking…' : 'Verify and sign in'}
        </Button>
      </form>
      <Button type="button" variant="ghost" size="sm" disabled={check.isPending} onClick={onBack}>
        Start sign-in again
      </Button>
    </div>
  )
}

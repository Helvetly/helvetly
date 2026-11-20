'use client'
import { Button } from '@helvetly/ui/components/button'
import { Field, FieldError, FieldLabel } from '@helvetly/ui/components/field'
import { Input } from '@helvetly/ui/components/input'
import { Logo } from '@helvetly/ui/components/logo'
import { errorMessage } from '@helvetly/ui/lib/http'
import { translate as uiText } from '@helvetly/ui/lib/i18n'
import { useMutation } from '@tanstack/react-query'
import { MailCheck } from 'lucide-react'
import { useState } from 'react'

import { translate } from '@/lib/i18n'
import { emailPortalLinks } from '@/lib/portal'

/**
 * The shared portal's page: it signs nobody in. A client signs in at their supplier's own portal address, and an
 * address can ask for an email with all of its links. The page answers every address alike.
 */
export function PortalLinksRequest() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const send = useMutation({ mutationFn: emailPortalLinks })

  if (send.isSuccess)
    return (
      <div className="grid justify-items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-surface text-brand">
          <MailCheck aria-hidden className="size-6" />
        </span>
        <h1 className="text-page font-semibold tracking-tight">{translate('checkYourInbox')}</h1>
        <p className="text-body text-balance text-muted-foreground">
          {translate('ifThisAddressHasAPortal', { email: send.variables })}
        </p>
        <Button
          variant="link"
          onClick={() => {
            send.reset()
            setEmail('')
          }}
        >
          {translate('useAnotherAddress')}
        </Button>
      </div>
    )

  return (
    <div className="grid gap-7">
      <div className="grid justify-items-center gap-2 text-center">
        <span className="mb-3">
          <Logo className="size-12" />
        </span>
        <h1 className="text-page font-semibold tracking-tight text-balance">
          {translate('signInThroughYourSuppliersLink')}
        </h1>
        <p className="text-body text-balance text-muted-foreground">
          {translate('yourSupplierSentYouTheLink')}
        </p>
      </div>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          const address = email.trim().toLowerCase()
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
            setError(uiText('enterAnEmailAddressSuchAsAnaExampleCom'))
            return
          }
          setError('')
          send.mutate(address, { onError: (e) => setError(errorMessage(e)) })
        }}
      >
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="email">{uiText('email')}</FieldLabel>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            placeholder={uiText('youCompanyCom')}
            className="h-10"
            value={email}
            aria-invalid={!!error}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError>{error}</FieldError>
        </Field>
        <Button type="submit" size="xl" disabled={send.isPending}>
          {translate('emailMeMyPortalLinks')}
        </Button>
      </form>
    </div>
  )
}

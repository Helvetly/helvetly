'use client'

import { Button } from '@helvetly/ui/components/button'
import { Field, FieldError, FieldLabel } from '@helvetly/ui/components/field'
import { Input } from '@helvetly/ui/components/input'
import { Logo } from '@helvetly/ui/components/logo'
import { ApiError, errorMessage, type EmailCodeSent } from '@helvetly/ui/lib/http'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const CODE_LENGTH = 6

export function codeErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error)
  switch (error.code) {
    case 'code_invalid': {
      const left = Number(error.details.attempts_left)
      if (!Number.isFinite(left)) return 'That code is not right.'
      return `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
    }
    case 'code_expired':
      return 'This code no longer works: it expired, was used or had too many wrong tries. Send a new one.'
    case 'code_cooldown':
      return 'A code was just sent. Wait a few seconds before asking for another.'
    case 'rate_limited':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'mail_failed':
      return 'The email could not be sent. Try again in a minute.'
    case 'invalid_email':
      return 'Enter an email address such as ana@example.com.'
    default:
      return error.message
  }
}

/** Seconds left until `until` (a timestamp in ms), ticking every second and stopping at 0. */
function useCountdown(until: number) {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= until) window.clearInterval(id)
    }, 1000)
    return () => window.clearInterval(id)
  }, [until])

  return Math.max(0, Math.ceil((until - now) / 1000))
}

export function EmailAddressForm({
  send,
  onSent,
  autoComplete,
}: {
  send: (email: string) => Promise<EmailCodeSent>
  onSent: (email: string, sent: EmailCodeSent) => void
  /** "email webauthn" when the field also offers saved passkeys. */
  autoComplete: string
}) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const start = useMutation({
    mutationFn: send,
    onSuccess: (sent, address) => onSent(address, sent),
    onError: (e) => setError(codeErrorMessage(e)),
  })

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        const address = email.trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
          setError('Enter an email address such as ana@example.com.')
          return
        }
        setError('')
        start.mutate(address)
      }}
    >
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete={autoComplete}
          spellCheck={false}
          placeholder="you@company.com"
          className="h-10"
          value={email}
          aria-invalid={!!error}
          onChange={(event) => setEmail(event.target.value)}
        />
        <FieldError>{error}</FieldError>
      </Field>
      <Button type="submit" size="xl" disabled={start.isPending}>
        {start.isPending ? 'Sending code…' : 'Continue'}
      </Button>
    </form>
  )
}

/**
 * Six boxes over ONE real input, so typing, pasting and the phone's one-time-code autofill all
 * work. Submits by itself at six digits.
 */
export function EmailCodeForm<Result>({
  email,
  sent,
  verify,
  resend,
  onDone,
  onBack,
}: {
  email: string
  sent: EmailCodeSent
  verify: (code: string) => Promise<Result>
  resend: () => Promise<EmailCodeSent>
  onDone: (result: Result) => void
  onBack: () => void
}) {
  const [code, setCode] = useState('')
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState('')
  const [resendAt, setResendAt] = useState(() => Date.now() + sent.resend_in * 1000)
  const wait = useCountdown(resendAt)
  const input = useRef<HTMLInputElement>(null)

  // The code field takes focus when this step opens (the address step's button had it).
  useEffect(() => input.current?.focus(), [])

  const check = useMutation({
    mutationFn: verify,
    onSuccess: onDone,
    onError: (e) => {
      setError(codeErrorMessage(e))
      setCode('')
    },
  })
  const again = useMutation({
    mutationFn: resend,
    onSuccess: (next) => {
      setResendAt(Date.now() + next.resend_in * 1000)
      setError('')
      // A toast (an aria-live region) instead of a line under the boxes, which are for errors.
      toast.success('New code sent', { description: 'The previous one no longer works.' })
    },
    onError: (e) => {
      const retryIn = e instanceof ApiError ? Number(e.details.resend_in) : Number.NaN
      if (Number.isFinite(retryIn)) setResendAt(Date.now() + retryIn * 1000)
      setError(codeErrorMessage(e))
    },
  })

  const submit = (value: string) => {
    if (value.length !== CODE_LENGTH) {
      setError('Enter the 6-digit code from the email.')
      return
    }
    if (check.isPending) return
    setError('')
    check.mutate(value)
  }

  return (
    <div className="grid gap-6">
      <div className="grid justify-items-center gap-2 text-center">
        <Logo className="mb-4 size-11" />
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-sm text-balance text-muted-foreground">
          We sent a 6-digit code to <strong className="font-medium text-foreground">{email}</strong>
          . It works once, for {Math.round(sent.expires_in / 60)} minutes.
        </p>
      </div>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit(code)
        }}
      >
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="code" className="sr-only">
            Code
          </FieldLabel>
          <div className="relative">
            <div aria-hidden className="grid grid-cols-6 gap-2">
              {Array.from({ length: CODE_LENGTH }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex h-12 items-center justify-center rounded-lg border border-input bg-card text-xl font-medium tabular-nums shadow-xs transition-[border-color,box-shadow]',
                    error && 'border-destructive',
                    focused &&
                      i === Math.min(code.length, CODE_LENGTH - 1) &&
                      'border-foreground/40 ring-3 ring-ring/30',
                  )}
                >
                  {code[i] ?? ''}
                </div>
              ))}
            </div>
            <Input
              id="code"
              ref={input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH}
              className="absolute inset-0 h-full border-0 bg-transparent text-transparent caret-transparent shadow-none selection:bg-transparent focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent"
              value={code}
              aria-invalid={!!error}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH)
                setCode(digits)
                if (digits.length === CODE_LENGTH) submit(digits)
              }}
            />
          </div>
          <FieldError>{error}</FieldError>
        </Field>
        <Button type="submit" size="xl" disabled={check.isPending}>
          {check.isPending ? 'Checking…' : 'Continue'}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> Use a different email
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="tabular-nums"
          disabled={wait > 0 || again.isPending}
          onClick={() => again.mutate()}
        >
          {wait > 0 ? `Resend code in ${wait}s` : again.isPending ? 'Sending…' : 'Resend code'}
        </Button>
      </div>
    </div>
  )
}

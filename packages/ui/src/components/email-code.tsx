'use client'
import { Button } from '@helvetly/ui/components/button'
import { Field, FieldError, FieldLabel } from '@helvetly/ui/components/field'
import { Input } from '@helvetly/ui/components/input'
import { Logo } from '@helvetly/ui/components/logo'
import { fieldSurface } from '@helvetly/ui/lib/field-surface'
import { ApiError, errorMessage, type EmailCodeSent } from '@helvetly/ui/lib/http'
import { translate } from '@helvetly/ui/lib/i18n'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const CODE_LENGTH = 6
// A cooldown answer is trusted only inside the range the API can send; anything else stays an error.
const MAX_SENT_SECONDS = 3600

/** The times of a code that was sent a moment ago, when a `code_cooldown` answer carries valid ones. */
function recentCode(error: unknown): EmailCodeSent | null {
  if (!(error instanceof ApiError) || error.code !== 'code_cooldown') return null
  const { resend_in, expires_in } = error.details
  return validSeconds(resend_in) && validSeconds(expires_in) ? { resend_in, expires_in } : null
}

const validSeconds = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= MAX_SENT_SECONDS

export function codeErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error)
  switch (error.code) {
    case 'code_invalid': {
      const left = Number(error.details.attempts_left)
      if (!Number.isFinite(left)) return translate('thatCodeIsNotRight')
      return translate('thatCodeIsNotRightLeft', { count: left })
    }
    case 'code_expired':
      return translate('thisCodeNoLongerWorksItExpiredWasUsed')
    case 'code_cooldown':
      return translate('aCodeWasJustSentWaitAFewSeconds')
    case 'rate_limited':
      return translate('tooManyAttemptsWaitAFewMinutesAndTry')
    case 'mail_failed':
      return translate('theEmailCouldNotBeSentTryAgainIn')
    case 'invalid_email':
      return translate('enterAnEmailAddressSuchAsAnaExampleCom')
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
    onError: (e, address) => {
      // The code is already on its way: let the person type it instead of blocking on the address step.
      const recent = recentCode(e)
      if (recent) onSent(address, recent)
      else setError(codeErrorMessage(e))
    },
  })

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        const address = email.trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
          setError(translate('enterAnEmailAddressSuchAsAnaExampleCom'))
          return
        }
        setError('')
        start.mutate(address)
      }}
    >
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="email">{translate('email')}</FieldLabel>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete={autoComplete}
          spellCheck={false}
          placeholder={translate('youCompanyCom')}
          value={email}
          aria-invalid={!!error}
          onChange={(event) => setEmail(event.target.value)}
        />
        <FieldError>{error}</FieldError>
      </Field>
      <Button type="submit" size="xl" disabled={start.isPending}>
        {start.isPending ? translate('sendingCode') : translate('continue')}
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
      toast.success(translate('newCodeSent'), {
        description: translate('thePreviousOneNoLongerWorks'),
      })
    },
    onError: (e) => {
      const retryIn = e instanceof ApiError ? Number(e.details.resend_in) : Number.NaN
      if (Number.isFinite(retryIn)) setResendAt(Date.now() + retryIn * 1000)
      setError(codeErrorMessage(e))
    },
  })

  const submit = (value: string) => {
    if (value.length !== CODE_LENGTH) {
      setError(translate('enterThe6DigitCodeFromTheEmail'))
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
        <h1 className="text-xl font-semibold tracking-tight">{translate('checkYourEmail')}</h1>
        <p className="text-sm text-balance text-muted-foreground">
          {translate('weSentA6DigitCodeTo')}
          <strong className="font-medium text-foreground">{email}</strong>
          {translate('itWorksOnceFor')} {translate('message')}
          {Math.round(sent.expires_in / 60)}
          {translate('minutes')}
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
            {translate('code')}
          </FieldLabel>
          <div className="relative">
            <div aria-hidden className="grid grid-cols-6 gap-2">
              {Array.from({ length: CODE_LENGTH }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    fieldSurface,
                    'flex h-12 items-center justify-center text-xl font-medium tabular-nums',
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
              // The six boxes above are the field; this one only takes the typing.
              className="field-quiet absolute inset-0 h-full border-0 bg-transparent text-transparent caret-transparent shadow-none selection:bg-transparent focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent"
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
          {check.isPending ? translate('checking') : translate('continue')}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft />
          {translate('useADifferentEmail')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="tabular-nums"
          disabled={wait > 0 || again.isPending}
          onClick={() => again.mutate()}
        >
          {wait > 0
            ? translate('resendCodeInS', { wait: wait })
            : again.isPending
              ? translate('sending')
              : translate('resendCode')}
        </Button>
      </div>
    </div>
  )
}

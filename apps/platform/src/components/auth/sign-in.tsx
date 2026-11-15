'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { EmailAddressForm, EmailCodeForm } from '@helvetly/ui/components/email-code'
import { Loader } from '@helvetly/ui/components/loader'
import { Logo } from '@helvetly/ui/components/logo'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, LoaderCircle } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import {
  api,
  ApiError,
  browserTimeZone,
  errorMessage,
  googleStartUrl,
  request,
  type AuthConfig,
  type Session,
  type EmailCodeSent,
  type SignInResult,
  type TwoFactorRequired,
} from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  getPasskey,
  passkeyAutofillAvailable,
  passkeyCancelled,
  passkeysSupported,
} from '@/lib/passkeys'
import { useAuthConfig } from '@/lib/queries'
import { safeNextPath } from '@/lib/safe'

import { useFinishSignIn } from './finish-sign-in'
import { TwoFactorSignIn } from './two-factor-sign-in'

/** Reasons for a Google sign-in that came back to /login?error=<code>. */
const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: translate('theSignInAtGoogleWasCancelled'),
  login_expired: translate('theSignInTookTooLongOrStartedIn'),
  login_failed: translate('theSignInWithGoogleDidNotWorkTry'),
  email_unverified: translate('thisGoogleAccountHasNoVerifiedEmailAddress'),
  identity_taken: translate('thatGoogleAccountIsAlreadyLinkedToAnotherPerson'),
}

function passkeyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'passkey_failed':
        return translate('thisPasskeyCouldNotBeCheckedItMayHave')
      case 'passkey_cloned':
        return translate('thisPasskeyLooksCopiedToAnotherDeviceSignIn')
      case 'passkey_expired':
        return translate('thePasskeyPromptTookTooLongTryAgain')
      case 'rate_limited':
        return translate('tooManyAttemptsWaitAFewMinutesAndTry')
    }
  }
  return errorMessage(error)
}

/**
 * A passkey button that opens the browser's prompt and, where the browser offers it, saved passkeys
 * in the email field's autofill (conditional mediation) while the form is open. The button aborts
 * the autofill request: the browser takes one WebAuthn request at a time.
 */
function usePasskeySignIn(
  enabled: boolean,
  autofill: boolean,
  next: string,
  finish: (result: SignInResult) => void,
) {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const autofillRequest = useRef<AbortController | null>(null)

  const run = async (mediation?: CredentialMediationRequirement, signal?: AbortSignal) => {
    const challenge = await api.startPasskeySignIn()
    const response = await getPasskey(challenge.options, { mediation, signal })
    finish(await api.finishPasskeySignIn({ challenge_id: challenge.challenge_id, response, next }))
  }
  const runAutofill = useEffectEvent((signal: AbortSignal) => run('conditional', signal))
  const report = (e: unknown) => {
    if (!passkeyCancelled(e)) setError(passkeyErrorMessage(e))
  }
  // The autofill runs unasked: only a passkey the person picked that failed (from /finish) is news.
  const reportAutofill = useEffectEvent((e: unknown) => {
    if (e instanceof ApiError && e.code.startsWith('passkey_')) report(e)
  })

  useEffect(() => {
    if (!enabled || !autofill) return
    const controller = new AbortController()
    autofillRequest.current = controller
    void passkeyAutofillAvailable().then((available) => {
      if (available && !controller.signal.aborted)
        runAutofill(controller.signal).catch(reportAutofill)
    })
    return () => controller.abort()
  }, [enabled, autofill])

  const prompt = async () => {
    autofillRequest.current?.abort()
    setError('')
    setPending(true)
    await run().catch(report)
    setPending(false)
  }

  return { error, pending, prompt }
}

const subscribeNever = () => () => {}

/** Someone already signed in has nothing to do here: on to where they were going (or home). */
export function useSignedInElsewhere() {
  const router = useRouter()
  const next = safeNextPath(useSearchParams().get('next'))
  const check = useQuery({
    queryKey: ['login', 'session'],
    // public: a 401 here is the expected "signed out", not a reason to send anyone to /login.
    queryFn: async () => {
      try {
        return await request<Session>('/session', { public: true })
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    retry: false,
    staleTime: 0,
  })
  const signedIn = Boolean(check.data)
  useEffect(() => {
    if (signedIn) router.replace(next)
  }, [signedIn, next, router])
  return check.isPending || signedIn
}

export function SignIn() {
  const config = useAuthConfig()
  const leaving = useSignedInElsewhere()

  if (config.isPending || leaving) {
    return <Loader className="min-h-56" />
  }
  if (config.error) {
    return (
      <Intro
        title={translate('signInIsUnavailable')}
        subtitle={translate('weCanTReachHelvetlyRightNow')}
      >
        <Button variant="outline" size="xl" onClick={() => void config.refetch()}>
          {translate('tryAgain')}
        </Button>
      </Intro>
    )
  }
  if (!config.data.google && !config.data.email && !config.data.passkey) {
    return (
      <Intro
        title={translate('signInIsNotSetUp')}
        subtitle={translate('noSignInMethodIsEnabledOnThisServer')}
      />
    )
  }
  return <SignInMethods config={config.data} />
}

function Intro({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children?: ReactNode
}) {
  return (
    <div className="grid gap-8">
      <div className="grid justify-items-center gap-2 text-center">
        <Logo className="mb-4 size-11" />
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-balance text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {children}
    </p>
  )
}

const methodButton = 'w-full'

function SignInMethods({ config }: { config: AuthConfig }) {
  const params = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const googleError = params.get('error')
  const [codeFor, setCodeFor] = useState<{ email: string; sent: EmailCodeSent } | null>(null)
  const [factor, setFactor] = useState<TwoFactorRequired | null>(() => {
    if (typeof window === 'undefined' || params.get('two_factor') !== '1') return null
    const challenge = new URLSearchParams(window.location.hash.slice(1)).get('challenge')
    return challenge && /^[A-Za-z0-9_-]{20,128}$/.test(challenge)
      ? { two_factor_required: true, challenge_id: challenge }
      : null
  })
  const finish = useFinishSignIn()
  const complete = (result: SignInResult) => {
    if ('two_factor_required' in result) {
      setFactor(result)
      return
    }
    finish(result)
  }
  useEffect(() => {
    if (params.get('two_factor') !== '1') return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [params])
  // WebAuthn support is only known in the browser.
  const supported = useSyncExternalStore(subscribeNever, passkeysSupported, () => false)
  const passkey = config.passkey && supported
  const passkeySignIn = usePasskeySignIn(
    passkey && !factor,
    config.email && !codeFor && !factor,
    next,
    complete,
  )

  if (factor)
    return (
      <TwoFactorSignIn
        challengeId={factor.challenge_id}
        onDone={finish}
        onBack={() => {
          setFactor(null)
          setCodeFor(null)
        }}
      />
    )

  if (codeFor) {
    return (
      <EmailCodeForm
        email={codeFor.email}
        sent={codeFor.sent}
        verify={(code) =>
          api.verifyEmailSignIn({ email: codeFor.email, code, next, timezone: browserTimeZone() })
        }
        resend={() => api.startEmailSignIn(codeFor.email)}
        onDone={complete}
        onBack={() => setCodeFor(null)}
      />
    )
  }

  return (
    <Intro
      title={translate('welcomeToHelvetly')}
      subtitle={translate('signInOrCreateYourAccountInSeconds')}
    >
      <div className="grid gap-3">
        {googleError && (
          <Alert>{GOOGLE_ERRORS[googleError] ?? translate('theSignInDidNotWorkTryAgain')}</Alert>
        )}
        {config.google && (
          <Button asChild variant="outline" size="xl" className={methodButton}>
            <a href={localizedHref(googleStartUrl(next))}>
              <GoogleMark />
              {translate('continueWithGoogle')}
            </a>
          </Button>
        )}
        {passkey && (
          <Button
            variant="outline"
            size="xl"
            className={methodButton}
            disabled={passkeySignIn.pending}
            onClick={() => void passkeySignIn.prompt()}
          >
            {passkeySignIn.pending ? (
              <LoaderCircle className="animate-spin text-muted-foreground" />
            ) : (
              <KeyRound className="text-primary" />
            )}
            {passkeySignIn.pending
              ? translate('waitingForYourPasskey')
              : translate('continueWithAPasskey')}
          </Button>
        )}
        {passkeySignIn.error && <Alert>{passkeySignIn.error}</Alert>}
        {(config.google || passkey) && config.email && (
          <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            {translate('or3')}
            <span className="h-px flex-1 bg-border" />
            {translate('message2')}
          </div>
        )}
        {config.email && (
          <EmailAddressForm
            send={api.startEmailSignIn}
            autoComplete={passkey ? 'email webauthn' : 'email'}
            onSent={(email, sent) => setCodeFor({ email, sent })}
          />
        )}
      </div>
    </Intro>
  )
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  )
}

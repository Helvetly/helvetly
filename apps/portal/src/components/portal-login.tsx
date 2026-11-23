'use client'
import { Callout } from '@helvetly/ui/components/callout'
import { EmailAddressForm, EmailCodeForm } from '@helvetly/ui/components/email-code'
import { LanguageDialogButton } from '@helvetly/ui/components/language-switcher'
import { Logo } from '@helvetly/ui/components/logo'
import type { EmailCodeSent } from '@helvetly/ui/lib/http'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { translate } from '@/lib/i18n'
import {
  getPortalScope,
  getPortalSession,
  isPortalClosed,
  portalKeys,
  startPortalSignIn,
  verifyPortalCode,
} from '@/lib/portal'
import { scoped, scopePrefix } from '@/lib/scope'

import { WorkspaceMark } from './portal-bits'
import { PortalLinksRequest } from './portal-links-request'
import { PortalNotFound } from './portal-not-found'

/**
 * The sign-in's email and code steps at a workspace's own portal address, against the portal's own endpoints, with
 * that supplier's mark and name. The shared portal (no workspace's address) signs nobody in: it offers the
 * suppliers' links by email instead.
 */
export function PortalLogin(props: { workspace?: { name: string; logoUrl?: string } }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<{ email: string; sent: EmailCodeSent } | null>(null)
  // A member's preview link that was used or ran out lands here (portal/preview.go). Read once on the client: the
  // static page renders nothing of it before the queries below settle.
  const [previewExpired] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('preview') === 'expired',
  )
  // A client already signed in has nothing to do here.
  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })
  // Under a workspace's own address (/w/<slug>/ or its own domain), that workspace's mark and name.
  const scope = useQuery({ queryKey: portalKeys.scope, queryFn: getPortalScope, retry: false })
  const workspace =
    props.workspace ??
    (scope.data ? { name: scope.data.name, logoUrl: scope.data.logo_url ?? undefined } : undefined)
  const shared = !props.workspace && scope.data === null && scopePrefix() === ''
  const signedIn = Boolean(session.data)
  useEffect(() => {
    if (signedIn) router.replace(scoped('/'))
  }, [signedIn, router])
  if (isPortalClosed(scope.error)) return <PortalNotFound closed />
  if (session.isPending || scope.isPending || signedIn)
    return <div className="min-h-svh bg-background" aria-busy />

  return (
    <div className="flex min-h-svh items-center justify-center bg-background bg-[radial-gradient(80rem_36rem_at_50%_-8rem,var(--brand-surface),transparent_70%)] px-4 py-10">
      <div className="grid w-full max-w-[27rem] gap-5">
        {previewExpired && (
          <Callout
            role="alert"
            tone="warning"
            icon={TriangleAlert}
            className="rounded-lg px-3 py-2.5"
          >
            {translate('previewLinkExpired')}
          </Callout>
        )}
        {/* A card from sm up; a phone keeps the full width for the six code boxes. */}
        <div className="sm:rounded-2xl sm:bg-card sm:p-10 sm:shadow-elevation-soft">
          {shared ? (
            <PortalLinksRequest />
          ) : step ? (
            <EmailCodeForm
              email={step.email}
              sent={step.sent}
              verify={(code) => verifyPortalCode(step.email, code)}
              resend={() => startPortalSignIn(step.email)}
              onDone={() => {
                queryClient.clear()
                router.replace(scoped('/'))
              }}
              onBack={() => setStep(null)}
            />
          ) : (
            <div className="grid gap-7">
              <div className="grid justify-items-center gap-2 text-center">
                <span className="mb-3">
                  {workspace ? (
                    <WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} large />
                  ) : (
                    <Logo className="size-12" />
                  )}
                </span>
                {workspace && (
                  <p className="text-body-sm font-medium text-muted-foreground">{workspace.name}</p>
                )}
                <h1 className="text-page font-semibold tracking-tight">
                  {translate('clientPortal')}
                </h1>
                <p className="text-body text-balance text-muted-foreground">
                  {translate('yourInvoicesWorkAndDocumentsFromYourSupplierIn')}
                </p>
              </div>
              <EmailAddressForm
                send={startPortalSignIn}
                autoComplete="email"
                onSent={(email, sent) => setStep({ email, sent })}
              />
            </div>
          )}
        </div>
        {/* The shared page emails portal links, not a code. */}
        {!shared && (
          <p className="text-center text-body-sm text-balance text-muted-foreground">
            <ShieldCheck className="mr-1.5 inline size-4 -translate-y-px text-brand" aria-hidden />
            {translate('noPasswordWeEmailYouAOneTimeCode')}
          </p>
        )}
        <div className="flex justify-center">
          <LanguageDialogButton />
        </div>
      </div>
    </div>
  )
}

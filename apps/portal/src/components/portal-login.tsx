'use client'
import { localizedHref } from '@helvetly/i18n'
import { EmailAddressForm, EmailCodeForm } from '@helvetly/ui/components/email-code'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { LanguageDialogButton } from '@helvetly/ui/components/language-switcher'
import { Logo } from '@helvetly/ui/components/logo'
import type { EmailCodeSent } from '@helvetly/ui/lib/http'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { translate } from '@/lib/i18n'
import {
  getPortalScope,
  getPortalSession,
  portalKeys,
  redeemPortalTicket,
  startPortalSignIn,
  verifyPortalCode,
  type PortalAccount,
} from '@/lib/portal'
import { scoped } from '@/lib/scope'
import { siteUrl } from '@/lib/site'

import { PortalAccountChooser } from './portal-account-chooser'
import { WorkspaceMark } from './portal-bits'

/**
 * The staff sign-in's email and code steps, against the portal's own endpoints. With `workspace` the
 * page carries that supplier's mark and name instead of Helvetly's.
 */
export function PortalLogin(props: { workspace?: { name: string; logoUrl?: string } }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<{ email: string; sent: EmailCodeSent } | null>(null)
  const [accounts, setAccounts] = useState<PortalAccount[] | null>(null)
  // The shared portal's account choice lands here with a one-time ticket in the fragment: spend it at once.
  const ticket = useMutation({
    mutationFn: redeemPortalTicket,
    onSuccess: () => {
      queryClient.clear()
      router.replace(scoped('/'))
    },
  })
  const redeem = ticket.mutate
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('ticket')
    if (!value) return
    // Off the address first: a ticket is never left in history or reused by a reload.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    redeem(value)
  }, [redeem])
  // A client already signed in has nothing to do here.
  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })
  // Under a workspace's own address (/w/<slug>/), that workspace's mark and name.
  const scope = useQuery({ queryKey: portalKeys.scope, queryFn: getPortalScope, retry: false })
  const workspace =
    props.workspace ??
    (scope.data ? { name: scope.data.name, logoUrl: scope.data.logo_url ?? undefined } : undefined)
  const signedIn = Boolean(session.data)
  useEffect(() => {
    if (signedIn) router.replace(scoped('/'))
  }, [signedIn, router])
  if (session.isPending || scope.isPending || signedIn || ticket.isPending || ticket.isSuccess)
    return <div className="min-h-svh bg-background" aria-busy />

  return (
    <div className="flex min-h-svh items-center justify-center bg-background bg-[radial-gradient(80rem_36rem_at_50%_-8rem,var(--brand-surface),transparent_70%)] px-4 py-10">
      <div className="grid w-full max-w-[27rem] gap-5">
        {/* A card from sm up; a phone keeps the full width for the six code boxes. */}
        <div className="sm:rounded-2xl sm:bg-card sm:p-10 sm:shadow-elevation-soft">
          {step && accounts ? (
            <PortalAccountChooser
              email={step.email}
              accounts={accounts}
              onBack={() => {
                setAccounts(null)
                setStep(null)
              }}
            />
          ) : step ? (
            <EmailCodeForm
              email={step.email}
              sent={step.sent}
              verify={(code) => verifyPortalCode(step.email, code)}
              resend={() => startPortalSignIn(step.email)}
              onDone={(result) => {
                if (result.accounts) {
                  setAccounts(result.accounts)
                  return
                }
                queryClient.clear()
                router.replace(scoped('/'))
              }}
              onBack={() => setStep(null)}
            />
          ) : (
            <div className="grid gap-7">
              {ticket.isError && <InlineError>{translate('thatSignInHasExpired')}</InlineError>}
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
        <p className="text-center text-body-sm text-balance text-muted-foreground">
          <ShieldCheck className="mr-1.5 inline size-4 -translate-y-px text-brand" aria-hidden />
          {translate('noPasswordWeEmailYouAOneTimeCode')}
        </p>
        <p className="text-center text-body-sm text-muted-foreground">
          <a
            href={localizedHref(siteUrl('/privacy'))}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {translate('privacyPolicy')}
          </a>
        </p>
        <div className="-mt-3 flex justify-center">
          <LanguageDialogButton />
        </div>
      </div>
    </div>
  )
}

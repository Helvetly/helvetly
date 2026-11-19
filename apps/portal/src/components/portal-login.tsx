'use client'
import { localizedHref } from '@helvetly/i18n'
import { EmailAddressForm, EmailCodeForm } from '@helvetly/ui/components/email-code'
import { LanguageDialogButton } from '@helvetly/ui/components/language-switcher'
import { Logo } from '@helvetly/ui/components/logo'
import type { EmailCodeSent } from '@helvetly/ui/lib/http'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { translate } from '@/lib/i18n'
import {
  getPortalScope,
  getPortalSession,
  portalKeys,
  startPortalSignIn,
  verifyPortalCode,
} from '@/lib/portal'
import { scoped } from '@/lib/scope'
import { siteUrl } from '@/lib/site'

import { WorkspaceMark } from './workspace-mark'

/** The staff sign-in's email and code steps, against the portal's own endpoints. */
export function PortalLogin() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<{ email: string; sent: EmailCodeSent } | null>(null)
  // A client already signed in has nothing to do here.
  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })
  // Under a workspace's own address (/w/<slug>/), its name and logo instead of Helvetly's.
  const scope = useQuery({ queryKey: portalKeys.scope, queryFn: getPortalScope, retry: false })
  const brand = scope.data
  const signedIn = Boolean(session.data)
  useEffect(() => {
    if (signedIn) router.replace(scoped('/'))
  }, [signedIn, router])
  if (session.isPending || scope.isPending || signedIn)
    return <div className="min-h-svh bg-background" aria-busy />

  return (
    <div className="flex min-h-svh items-center justify-center bg-background bg-[radial-gradient(80rem_36rem_at_50%_-8rem,var(--brand-surface),transparent_70%)] px-4 py-10">
      <div className="grid w-full max-w-[25rem] gap-5">
        {/* A card from sm up; a phone keeps the full width for the six code boxes. */}
        <div className="sm:rounded-2xl sm:bg-card sm:p-8 sm:shadow-elevation-1">
          {step ? (
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
            <div className="grid gap-6">
              <div className="grid justify-items-center gap-2 text-center">
                {brand ? (
                  <WorkspaceMark
                    name={brand.name}
                    logoUrl={brand.logo_url}
                    className="mb-3 size-11 text-body"
                  />
                ) : (
                  <Logo className="mb-3 size-11" />
                )}
                <h1 className="text-xl font-semibold tracking-tight">
                  {brand?.name ?? translate('clientPortal')}
                </h1>
                <p className="text-sm text-balance text-muted-foreground">
                  {brand
                    ? translate('workspacePortalIntro')
                    : translate('yourInvoicesWorkAndDocumentsFromYourSupplierIn')}
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
          <a href={localizedHref(siteUrl('/privacy'))} className="underline">
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

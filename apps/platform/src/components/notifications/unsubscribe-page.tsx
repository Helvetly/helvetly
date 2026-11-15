'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { useMutation } from '@tanstack/react-query'
import { Loader2, MailX } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { EVENT_LABELS, unsubscribe } from '@/lib/notifications'

import { PREFS_HREF } from './prefs-drawer'

/** The unsubscribe link of a notification email (`/unsubscribe#<token>`): turns that email off, no sign-in. */
export function UnsubscribePage() {
  const run = useMutation({
    mutationFn: (token: string) =>
      token
        ? unsubscribe(token)
        : Promise.reject(new Error(translate('openTheLinkFromYourEmailAgainTheWhole'))),
  })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // In the fragment, so the token never reaches a server log or a Referer.
    run.mutate(window.location.hash.slice(1))
  }, [run])

  const what = run.data ? EVENT_LABELS[run.data.event]?.label.toLowerCase() : undefined

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/50 px-4 dark:bg-background">
      <div className="grid max-w-sm justify-items-center gap-3 rounded-2xl bg-card px-8 py-10 text-center ring-1 ring-foreground/[0.06]">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <MailX className="size-5 stroke-[1.75]" aria-hidden />
        </span>
        {run.isSuccess ? (
          <>
            <h1 className="text-[19px] font-medium">{translate('youReUnsubscribed')}</h1>
            <p className="text-[14px] text-pretty text-muted-foreground">
              {translate('noMoreEmails')}
              {what ? translate('about2', { what: what }) : translate('ofThisKind')}
              {translate('theBellInHelvetlyStillShowsThemUnlessYou')}
            </p>
          </>
        ) : run.isError ? (
          <>
            <h1 className="text-[19px] font-medium">{translate('thisLinkDidnTWork')}</h1>
            <p className="text-[14px] text-pretty text-muted-foreground">
              {errorMessage(run.error)}
            </p>
          </>
        ) : (
          <>
            <Loader2 aria-hidden className="size-6 animate-spin text-muted-foreground" />
            <h1 className="text-[19px] font-medium">{translate('unsubscribing')}</h1>
          </>
        )}
        <Button asChild variant="outline" className="mt-2">
          {/* A full load: this page is outside the app, whose drawer opens from the address. */}
          <a href={localizedHref(PREFS_HREF)}>{translate('changeNotificationSettings')}</a>
        </Button>
      </div>
    </div>
  )
}

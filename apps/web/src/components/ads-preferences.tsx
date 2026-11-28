'use client'

import { publicHref } from '@helvetly/i18n/public-href'
import { Button } from '@helvetly/ui/components/button'
import { useLanguage } from '@helvetly/ui/components/language-provider'
import { adClick, measureAds } from '@helvetly/ui/lib/ads-measurement'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { translatorFor } from '@/lib/i18n'

function currentChoice() {
  if (!['www.helvetly.com', 'helvetly.com'].includes(location.hostname)) return null
  return document.cookie.match(/(?:^|; )helvetly_ads=(yes|no)(?:;|$)/)?.[1] ?? 'unset'
}

function subscribe(listener: () => void) {
  window.addEventListener('focus', listener)
  window.addEventListener('ads-choice', listener)
  return () => {
    window.removeEventListener('focus', listener)
    window.removeEventListener('ads-choice', listener)
  }
}
const serverChoice = () => null

export function AdsPreferences() {
  const language = useLanguage()
  const t = translatorFor(language)
  const choice = useSyncExternalStore(subscribe, currentChoice, serverChoice)
  const click = choice === null ? '' : adClick(location.search)
  const [open, setOpen] = useState<boolean>()
  const settings = useRef<HTMLButtonElement>(null)
  const decline = useRef<HTMLButtonElement>(null)
  const visible = open ?? (Boolean(click) && choice === 'unset')

  useEffect(() => {
    if (open) decline.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (click && choice === 'yes') return measureAds({ type: 'landing', click })
  }, [choice, click])

  const choose = (yes: boolean) => {
    document.cookie =
      'helvetly_ads=' +
      (yes ? 'yes' : 'no') +
      '; Domain=helvetly.com; Path=/; Max-Age=15552000; Secure; SameSite=Lax'
    if (!yes) {
      for (const cookie of document.cookie.split('; ')) {
        const name = cookie.split('=')[0]
        if (name && /^_gcl_[a-zA-Z0-9_]+$/.test(name)) {
          document.cookie = name + '=; Domain=helvetly.com; Path=/; Max-Age=0; Secure'
        }
      }
    }
    window.dispatchEvent(new Event('ads-choice'))
    setOpen(false)
    if (open) settings.current?.focus({ preventScroll: true })
  }
  if (choice === null) return null
  return (
    <>
      <button
        type="button"
        ref={settings}
        aria-expanded={visible}
        className="text-body-sm text-white/80 hover:text-white"
        onClick={() => setOpen(true)}
      >
        {t('adsPreferences')}
      </button>
      {visible &&
        createPortal(
          <aside
            aria-label={t('adsPreferences')}
            className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border bg-card p-4 text-card-foreground shadow-lg"
          >
            <p className="text-body-sm">
              {t('adsExplanation')}{' '}
              <a className="underline" href={publicHref('/privacy', language)}>
                {t('privacy')}
              </a>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                ref={decline}
                variant="outline"
                size="sm"
                onClick={() => choose(false)}
              >
                {t('adsDecline')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => choose(true)}>
                {t('adsAllow')}
              </Button>
            </div>
          </aside>,
          document.body,
        )}
    </>
  )
}

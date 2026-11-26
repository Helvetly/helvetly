'use client'

import { Button } from '@helvetly/ui/components/button'
import { Download } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { translate } from '@/lib/i18n'

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function PublicShare() {
  const token = useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1),
    () => '',
  )
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token)
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/30 p-5">
      <section className="grid w-full max-w-sm gap-4 rounded-xl border bg-card p-6">
        <h1 className="text-title font-semibold">{translate('documentSharePublicTitle')}</h1>
        <p className="text-body-sm text-muted-foreground">
          {translate(valid ? 'documentSharePublicHint' : 'thisLinkIsIncomplete')}
        </p>
        {valid && (
          <form method="post" action="/api/v1/public/document-share/download">
            <input type="hidden" name="token" value={token} />
            <Button type="submit">
              <Download />
              {translate('download')}
            </Button>
          </form>
        )}
      </section>
    </main>
  )
}

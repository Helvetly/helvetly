import { LanguageDialogButton } from '@helvetly/ui/components/language-switcher'
import { Link2Off } from 'lucide-react'

import { translate } from '@/lib/i18n'

/** A portal address nobody has (an unknown /w/<slug>/ or page): no way in, so only what to do about it. */
export function PortalNotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="grid max-w-[28rem] justify-items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Link2Off aria-hidden className="size-[22px] stroke-[1.75]" />
        </span>
        <h1 className="mt-2 text-title font-semibold tracking-[-0.015em] text-balance">
          {translate('portalAddressNotFound')}
        </h1>
        <p className="text-body text-balance text-muted-foreground">
          {translate('portalAddressNotFoundHint')}
        </p>
        <div className="mt-2">
          <LanguageDialogButton />
        </div>
      </div>
    </div>
  )
}

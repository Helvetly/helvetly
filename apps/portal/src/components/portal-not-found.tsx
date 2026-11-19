import { LanguageDialogButton } from '@helvetly/ui/components/language-switcher'
import { Link2Off, LockKeyhole } from 'lucide-react'

import { translate } from '@/lib/i18n'

/**
 * A portal address nobody has (an unknown /w/<slug>/ or page), or a portal its workspace turned off (`closed`): no way
 * in, so only what to do about it, and no name.
 */
export function PortalNotFound({ closed = false }: { closed?: boolean }) {
  const Icon = closed ? LockKeyhole : Link2Off
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="grid max-w-[28rem] justify-items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Icon aria-hidden className="size-[22px] stroke-[1.75]" />
        </span>
        <h1 className="mt-2 text-title font-semibold tracking-[-0.015em] text-balance">
          {translate(closed ? 'portalUnavailable' : 'portalAddressNotFound')}
        </h1>
        <p className="text-body text-balance text-muted-foreground">
          {translate(closed ? 'portalUnavailableHint' : 'portalAddressNotFoundHint')}
        </p>
        <div className="mt-2">
          <LanguageDialogButton />
        </div>
      </div>
    </div>
  )
}

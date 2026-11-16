'use client'
import { Button } from '@helvetly/ui/components/button'
import { Check, ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useLogoCrop } from '@/components/shared/logo-crop'
import { WorkspaceMark } from '@/components/shared/workspace-mark'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { LOGO_TYPES } from '@/lib/invoices'
import { useWorkspaceLogo } from '@/lib/workspaces'

import { HelpTip } from './help-tip'
import { SettingsSection } from './layout'

/**
 * The workspace's own mark: its preview as the switcher shows it, and the buttons to choose, replace or remove it.
 * Choosing opens the square crop; nothing is saved until it is confirmed. Only an owner or admin may change it.
 */
export function WorkspaceLogoControl({
  name,
  logoUrl,
  canEdit,
}: {
  name: string
  logoUrl?: string | null
  canEdit: boolean
}) {
  const logo = useWorkspaceLogo()
  const input = useRef<HTMLInputElement>(null)
  const [removeError, setRemoveError] = useState('')
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(null), 2500)
    return () => clearTimeout(timer)
  }, [done])
  const crop = useLogoCrop({
    kind: 'workspace',
    send: (file, handlers) => logo.upload.mutate(file, handlers),
    progress: logo.progress,
    onSaved: () => {
      setDone(translate('workspaceLogoSaved'))
      toast.success(translate('workspaceLogoSaved'))
    },
  })
  const error = crop.pickError || removeError
  const busy = logo.progress !== null || logo.remove.isPending

  return (
    <div className="grid gap-2" data-testid="workspace-logo">
      {crop.dialog}
      <input
        ref={input}
        type="file"
        accept={LOGO_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          setRemoveError('')
          setDone(null)
          crop.pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <div className="flex items-center gap-4">
        <WorkspaceMark name={name} logoUrl={logoUrl} className="size-16 rounded-2xl text-[26px]" />
        <div className="grid gap-1.5">
          {canEdit && (
            <span className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {!logoUrl && <ImagePlus />}
                {logoUrl ? translate('replace2') : translate('addLogo')}
              </Button>
              {logoUrl && (
                <Button
                  type="button"
                  variant="destructive-ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setRemoveError('')
                    setDone(null)
                    logo.remove.mutate(undefined, {
                      onSuccess: () => {
                        setDone(translate('workspaceLogoRemoved'))
                        toast.success(translate('workspaceLogoRemoved'))
                      },
                      onError: (failure) => setRemoveError(errorMessage(failure)),
                    })
                  }}
                >
                  <Trash2 />
                  {translate('remove')}
                </Button>
              )}
            </span>
          )}
          <span className="text-caption text-muted-foreground">
            {translate('logoSizeLimits', { min: 64, max: 1024 })}
          </span>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <output
        aria-live="polite"
        className="flex min-h-5 items-center gap-1.5 text-body-sm font-medium text-success"
      >
        {done && (
          <>
            <Check className="size-4" aria-hidden /> {done}
          </>
        )}
      </output>
    </div>
  )
}

/** The workspace logo's card in Settings → Workspace; the explanation sits behind its help icon. */
export function WorkspaceLogoSection({
  name,
  logoUrl,
  canEdit,
}: {
  name: string
  logoUrl?: string | null
  canEdit: boolean
}) {
  return (
    <SettingsSection
      id="workspace-logo"
      icon={ImagePlus}
      title={
        <span className="inline-flex items-center gap-1.5">
          {translate('workspaceLogo')}
          <HelpTip label={translate('workspaceLogo')}>{translate('workspaceLogoHelp')}</HelpTip>
        </span>
      }
    >
      <WorkspaceLogoControl name={name} logoUrl={logoUrl} canEdit={canEdit} />
    </SettingsSection>
  )
}

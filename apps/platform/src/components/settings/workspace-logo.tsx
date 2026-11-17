'use client'
import { Button } from '@helvetly/ui/components/button'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
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
 * The workspace's own mark, in the same dashed card as the document logo: its preview, and the buttons to choose (or drop a
 * file), replace or remove it. Picking or dropping opens the square crop; nothing is saved until it is confirmed. Only an owner or admin may change it.
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
  const [over, setOver] = useState(false)
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

  // Someone who may not change it sees the mark as the switcher shows it, nothing to pick.
  if (!canEdit)
    return (
      <div data-testid="workspace-logo">
        <WorkspaceMark name={name} logoUrl={logoUrl} className="size-16 rounded-2xl text-page" />
      </div>
    )

  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    if (busy) return
    setRemoveError('')
    setDone(null)
    crop.pick(event.dataTransfer.files[0])
  }

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
      {/* The same card as the document logo's: dashed, a pale thumbnail, a title, what fits and the buttons; drop works too. */}
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          'relative flex items-center gap-4 rounded-xl border border-dashed border-border bg-card p-4 transition-colors sm:gap-5',
          over && 'border-primary bg-primary/5',
          error && 'border-destructive/60',
        )}
      >
        {logoUrl ? (
          <WorkspaceMark
            name={name}
            logoUrl={logoUrl}
            className="size-20 shrink-0 rounded-lg ring-1 ring-border"
          />
        ) : (
          <span className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
            <ImagePlus className="size-7 stroke-[1.5]" />
          </span>
        )}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium">
            {logoUrl ? translate('yourLogo') : translate('uploadYourLogo')}
          </span>
          <span className="text-caption text-muted-foreground">
            {translate('pngOrJPEGUpTo2MBDropIt')}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {logo.progress !== null
                ? translate('uploading3')
                : logoUrl
                  ? translate('replace2')
                  : translate('chooseFile')}
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
        </span>
        {logo.progress !== null && (
          <span className="absolute inset-x-4 bottom-2 h-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(logo.progress * 100)}%` }}
            />
          </span>
        )}
      </div>
      {error && <InlineError>{error}</InlineError>}
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

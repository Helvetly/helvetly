'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Copy, ShieldCheck, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { LoadError } from '@/components/load-error'
import { SettingsRow, SettingsSection } from '@/components/settings/layout'
import {
  groupSecret,
  useAccount,
  useDisableTwoFactor,
  useEnableTwoFactor,
  useStartTwoFactor,
} from '@/lib/account'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'

/** An authenticator app as a second step after every sign-in. */
export function TwoFactor() {
  const account = useAccount()
  const start = useStartTwoFactor()
  const [dialog, setDialog] = useState<'enable' | 'disable' | null>(null)
  const status = account.data?.two_factor
  const open = (next: 'enable' | 'disable') => {
    if (next === 'enable') start.mutate()
    setDialog(next)
  }
  return (
    <SettingsSection
      id="two-factor"
      icon={ShieldCheck}
      title={translate('twoFactorAuthentication')}
      description={translate('afterSigningInAlsoAskForACodeFrom')}
    >
      {account.isPending ? (
        <Loader className="min-h-9" />
      ) : account.error || !status ? (
        <LoadError
          what={translate('twoFactorSettings')}
          error={account.error}
          onRetry={() => account.refetch()}
        />
      ) : (
        <ul>
          <SettingsRow
            icon={status.enabled ? <ShieldCheck className="text-success-solid" /> : <Smartphone />}
            title={
              <>
                {translate('authenticatorApp')}{' '}
                <Badge tone={status.enabled ? 'green' : 'neutral'}>
                  {status.enabled ? translate('on') : translate('off')}
                </Badge>
              </>
            }
            meta={
              status.enabled
                ? translate('recoveryLeft', {
                    recovery_codes_left: status.recovery_codes_left,
                    value2: status.recovery_codes_left === 1 ? 'code' : 'codes',
                  })
                : translate('recommendedForOwnersAndAdmins')
            }
          >
            <Button
              size="sm"
              variant={status.enabled ? 'outline' : 'default'}
              onClick={() => open(status.enabled ? 'disable' : 'enable')}
            >
              {status.enabled ? translate('turnOff') : translate('turnOn')}
            </Button>
          </SettingsRow>
        </ul>
      )}
      {dialog === 'enable' && <EnableDialog start={start} onClose={() => setDialog(null)} />}
      {dialog === 'disable' && <DisableDialog onClose={() => setDialog(null)} />}
    </SettingsSection>
  )
}

function EnableDialog({
  start,
  onClose,
}: {
  start: ReturnType<typeof useStartTwoFactor>
  onClose: () => void
}) {
  const enable = useEnableTwoFactor()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const setup = start.data

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (enable.isPending) return
    if (!/^\d{6}$/.test(code)) return setError(translate('enterThe6DigitsTheAppShows'))
    enable.mutate(code, {
      onSuccess: setCodes,
      onError: (err) => setError(errorMessage(err)),
    })
  }
  const copy = () =>
    void navigator.clipboard
      ?.writeText(codes?.join('\n') ?? '')
      .then(() => toast.success(translate('recoveryCodesCopied')))

  return (
    <Dialog open onOpenChange={(next) => !next && !enable.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        {codes ? (
          <>
            <DialogHeader>
              <DialogTitle>{translate('saveYourRecoveryCodes')}</DialogTitle>
              <DialogDescription>{translate('eachOneSignsYouInOnceIfYouLose')}</DialogDescription>
            </DialogHeader>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg bg-muted/60 p-4 font-mono text-body-sm">
              {codes.map((recovery) => (
                <li key={recovery}>{recovery}</li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={copy}>
                <Copy />
                {translate('copyCodes')}
              </Button>
              <Button
                onClick={() => {
                  toast.success(translate('twoFactorAuthenticationIsOn'))
                  onClose()
                }}
              >
                {translate('iVeSavedThem')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{translate('turnOnTwoFactorAuthentication')}</DialogTitle>
              <DialogDescription>
                {translate('scanTheQRCodeWithYourAuthenticatorAppThen')}
              </DialogDescription>
            </DialogHeader>
            {start.error ? (
              <InlineError>{errorMessage(start.error)}</InlineError>
            ) : !setup ? (
              <Loader className="min-h-40" />
            ) : (
              <TotpSetup secret={setup.secret} url={setup.otpauth_url} />
            )}
            <form onSubmit={submit} className="grid gap-5" noValidate>
              <FormField id="totp-code" required label={translate('codeFromTheApp')} error={error}>
                <Input
                  {...describedBy('totp-code', error)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="max-w-40 font-mono tracking-[0.3em]"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, ''))
                    setError('')
                  }}
                />
              </FormField>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={enable.isPending}
                >
                  {translate('cancel')}
                </Button>
                <Button type="submit" disabled={!setup || enable.isPending}>
                  {enable.isPending ? translate('checking') : translate('turnOn')}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The pending secret as a QR code, the main way in; the key to type and a link that opens an authenticator app on
 * this device are the fallbacks. The QR is drawn here from the otpauth URL, so the secret never leaves the page.
 */
function TotpSetup({ secret, url }: { secret: string; url: string }) {
  const copy = () =>
    void navigator.clipboard
      ?.writeText(secret)
      .then(() => toast.success(translate('keyCopied')))
      .catch(() => toast.error(translate('copyFailedSelectTheKeyAndCopyItBy')))
  return (
    <div className="grid justify-items-center gap-4 rounded-lg bg-muted/60 p-4">
      {/* A QR needs dark modules on light ground in either theme, so its tile stays white. */}
      <div className="rounded-md bg-white p-3">
        <QRCodeSVG
          value={url}
          size={168}
          level="M"
          title={translate('qrCodeForYourAuthenticatorApp')}
          data-testid="totp-qr"
        />
      </div>
      <div className="grid justify-items-center gap-1.5 text-center">
        <p className="text-body-sm text-muted-foreground">
          {translate('canTScanItEnterThisKeyInstead')}
        </p>
        <div className="flex items-center gap-1">
          <code className="font-mono text-sm text-balance select-all">{groupSecret(secret)}</code>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={translate('copyKey')}
                onClick={copy}
              >
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('copyKey')}</TooltipContent>
          </Tooltip>
        </div>
        <a
          href={localizedHref(url)}
          className="text-body-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {translate('openInAnAuthenticatorAppOnThisDevice')}
        </a>
      </div>
    </div>
  )
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const disable = useDisableTwoFactor()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (disable.isPending) return
    if (!code.trim()) return setError(translate('enterACodeFromTheAppOrARecovery'))
    disable.mutate(code.trim(), {
      onSuccess: () => {
        toast.success(translate('twoFactorAuthenticationIsOff'))
        onClose()
      },
      onError: (err) => setError(errorMessage(err)),
    })
  }
  return (
    <Dialog open onOpenChange={(next) => !next && !disable.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translate('turnOffTwoFactorAuthentication')}</DialogTitle>
          <DialogDescription>
            {translate('signingInWillNeedOnlyYourEmailCodeGoogle')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <FormField
            id="totp-off"
            required
            label={translate('codeFromTheAppOrARecoveryCode')}
            error={error}
          >
            <Input
              {...describedBy('totp-off', error)}
              autoComplete="one-time-code"
              className="max-w-56 font-mono"
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
                setError('')
              }}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {translate('keepItOn')}
            </Button>
            <Button type="submit" variant="destructive" disabled={disable.isPending}>
              {disable.isPending ? translate('turningOff') : translate('turnOff')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

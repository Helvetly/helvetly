'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { formatDate } from '@helvetly/ui/lib/format'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Fingerprint, KeyRound, Mail, Plus, Trash2, Unlink } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { GoogleMark } from '@/components/auth/sign-in'
import { toastError } from '@/components/billing/upgrade-prompt'
import { LoadError } from '@/components/load-error'
import { SettingsEmpty, SettingsRow, SettingsSection } from '@/components/settings/layout'
import { useAccount, useConnectGoogle, useDisconnect } from '@/lib/account'
import { api, errorMessage, type Passkey } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { createPasskey, deviceName, passkeyCancelled, passkeysSupported } from '@/lib/passkeys'
import { queryKeys, useAuthConfig, usePasskeys } from '@/lib/queries'

const subscribeNever = () => () => {}

/** The available ways in: email codes, linked Google, and passkeys. */
export function SignInMethods({ email }: { email: string }) {
  const account = useAccount()
  const google = account.data?.identities.find((identity) => identity.provider === 'google')
  const authConfig = useAuthConfig()
  const googleOn = authConfig.data?.google !== false
  const emailOn = authConfig.data?.email !== false
  const connect = useConnectGoogle()
  const disconnect = useDisconnect()

  return (
    <>
      <SettingsSection
        id="sign-in"
        icon={KeyRound}
        title={translate('signInMethods')}
        description={translate('helvetlyHasNoPasswordsSignInWithACode')}
      >
        <ul className="divide-y">
          <SettingsRow
            icon={<Mail />}
            title={
              <>
                {translate('emailCode')}
                <Badge variant="secondary">
                  {emailOn ? translate('on') : translate('unavailable')}
                </Badge>
              </>
            }
            meta={
              emailOn
                ? translate('a6DigitCodeTo', { email: email })
                : translate('emailSignInIsDisabledOnThisServer')
            }
          />
          {account.isPending ? (
            <li className="py-3">
              <Loader className="min-h-9" />
            </li>
          ) : account.error ? (
            <li className="py-3">
              <LoadError
                what={translate('connectedAccounts')}
                error={account.error}
                onRetry={() => account.refetch()}
              />
            </li>
          ) : (
            <SettingsRow
              icon={<GoogleMark />}
              title={
                <>
                  {translate('google')}
                  {google && <Badge variant="secondary">{translate('connected')}</Badge>}
                </>
              }
              meta={
                google
                  ? translate('since', {
                      email: google.email,
                      value2: formatDate(google.created_at),
                    })
                  : translate('signInWithOneClickFromYourGoogleAccount')
              }
            >
              {google ? (
                <Button
                  variant="destructive-ghost"
                  size="sm"
                  disabled={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate('google', {
                      onSuccess: () => toast.success(translate('googleDisconnected')),
                      onError: toastError,
                    })
                  }
                >
                  <Unlink />
                  {translate('disconnect')}
                </Button>
              ) : (
                googleOn && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={connect.isPending}
                    onClick={() =>
                      connect.mutate('/account', {
                        onError: toastError,
                      })
                    }
                  >
                    {translate('connect')}
                  </Button>
                )
              )}
            </SettingsRow>
          )}
        </ul>
      </SettingsSection>
      <Passkeys />
    </>
  )
}

function Passkeys() {
  const queryClient = useQueryClient()
  const passkeys = usePasskeys()
  const supported = useSyncExternalStore(subscribeNever, passkeysSupported, () => false)
  const setPasskeys = (list: Passkey[]) => queryClient.setQueryData(queryKeys.passkeys, list)

  const add = useMutation({
    mutationFn: async () => {
      const challenge = await api.startPasskey()
      const response = await createPasskey(challenge.options)
      return api.finishPasskey({
        challenge_id: challenge.challenge_id,
        name: deviceName(),
        response,
      })
    },
    onSuccess: ({ data }) => {
      setPasskeys(data)
      toast.success(translate('passkeyAddedYouCanSignInWithItNow'))
    },
    onError: (error) => {
      if (!passkeyCancelled(error)) toast.error(errorMessage(error))
    },
  })
  const remove = useMutation({
    mutationFn: api.deletePasskey,
    onSuccess: (_, id) => {
      setPasskeys((passkeys.data ?? []).filter((passkey) => passkey.id !== id))
      toast.success(translate('passkeyRemoved'))
    },
    onError: toastError,
  })

  const empty = passkeys.data?.length === 0
  // One "Add passkey": the empty state's primary action, else at the end of the list, under it.
  const addButton = (
    <Button
      size="sm"
      variant={empty ? 'default' : 'outline'}
      disabled={!supported || add.isPending}
      onClick={() => add.mutate()}
    >
      <Plus /> {add.isPending ? translate('waitingForYourDevice') : translate('addPasskey')}
    </Button>
  )

  return (
    <SettingsSection
      id="passkeys"
      icon={Fingerprint}
      title={translate('passkeys')}
      description={translate('yourFingerprintFaceOrDevicePINInsteadOfWaiting')}
    >
      {!supported && (
        <p data-wide className="text-body-sm text-muted-foreground">
          {translate('thisBrowserCanTCreatePasskeysAddOneFrom')}
        </p>
      )}
      {passkeys.isPending ? (
        <Loader className="min-h-9" />
      ) : passkeys.error ? (
        <LoadError
          what={translate('yourPasskeys')}
          error={passkeys.error}
          onRetry={() => passkeys.refetch()}
        />
      ) : passkeys.data.length === 0 ? (
        <SettingsEmpty icon={<KeyRound />} title={translate('noPasskeysYet')} action={addButton}>
          {translate('addOneToSignInWithYourFingerprintFace')}
        </SettingsEmpty>
      ) : (
        <ul className="divide-y">
          {passkeys.data.map((passkey) => (
            <SettingsRow
              key={passkey.id}
              icon={<KeyRound />}
              title={passkey.name}
              meta={translate('added', {
                value1: formatDate(passkey.created_at),
                value2: passkey.last_used_at
                  ? translate('lastUsed', { value1: formatDate(passkey.last_used_at) })
                  : translate('neverUsed'),
              })}
            >
              <Button
                variant="destructive-ghost"
                size="icon-sm"
                aria-label={translate('remove2', { name: passkey.name })}
                disabled={remove.isPending && remove.variables === passkey.id}
                onClick={() => remove.mutate(passkey.id)}
              >
                <Trash2 />
              </Button>
            </SettingsRow>
          ))}
        </ul>
      )}
      {passkeys.data && !empty && <div className="flex justify-end">{addButton}</div>}
    </SettingsSection>
  )
}

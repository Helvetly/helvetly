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
        title="Sign-in methods"
        description="Helvetly has no passwords. Sign in with a code sent to your email, your Google account or a passkey."
      >
        <ul className="divide-y">
          <SettingsRow
            icon={<Mail />}
            title={
              <>
                Email code <Badge variant="secondary">{emailOn ? 'On' : 'Unavailable'}</Badge>
              </>
            }
            meta={
              emailOn ? `A 6-digit code to ${email}` : 'Email sign-in is disabled on this server.'
            }
          />
          {account.isPending ? (
            <li className="py-3">
              <Loader className="min-h-9" />
            </li>
          ) : account.error ? (
            <li className="py-3">
              <LoadError
                what="connected accounts"
                error={account.error}
                onRetry={() => account.refetch()}
              />
            </li>
          ) : (
            <SettingsRow
              icon={<GoogleMark />}
              title={<>Google {google && <Badge variant="secondary">Connected</Badge>}</>}
              meta={
                google
                  ? `${google.email} · since ${formatDate(google.created_at)}`
                  : 'Sign in with one click from your Google account'
              }
            >
              {google ? (
                <Button
                  variant="destructive-ghost"
                  size="sm"
                  disabled={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate('google', {
                      onSuccess: () => toast.success('Google disconnected.'),
                      onError: toastError,
                    })
                  }
                >
                  <Unlink /> Disconnect
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
                    Connect
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
      toast.success('Passkey added. You can sign in with it now.')
    },
    onError: (error) => {
      if (!passkeyCancelled(error)) toast.error(errorMessage(error))
    },
  })
  const remove = useMutation({
    mutationFn: api.deletePasskey,
    onSuccess: (_, id) => {
      setPasskeys((passkeys.data ?? []).filter((passkey) => passkey.id !== id))
      toast.success('Passkey removed.')
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
      <Plus /> {add.isPending ? 'Waiting for your device…' : 'Add passkey'}
    </Button>
  )

  return (
    <SettingsSection
      id="passkeys"
      icon={Fingerprint}
      title="Passkeys"
      description="Your fingerprint, face or device PIN instead of waiting for an email."
    >
      {!supported && (
        <p data-wide className="text-body-sm text-muted-foreground">
          This browser can’t create passkeys. Add one from a browser that supports them.
        </p>
      )}
      {passkeys.isPending ? (
        <Loader className="min-h-9" />
      ) : passkeys.error ? (
        <LoadError what="your passkeys" error={passkeys.error} onRetry={() => passkeys.refetch()} />
      ) : passkeys.data.length === 0 ? (
        <SettingsEmpty icon={<KeyRound />} title="No passkeys yet" action={addButton}>
          Add one to sign in with your fingerprint, face or device PIN.
        </SettingsEmpty>
      ) : (
        <ul className="divide-y">
          {passkeys.data.map((passkey) => (
            <SettingsRow
              key={passkey.id}
              icon={<KeyRound />}
              title={passkey.name}
              meta={`Added ${formatDate(passkey.created_at)} · ${
                passkey.last_used_at
                  ? `last used ${formatDate(passkey.last_used_at)}`
                  : 'never used'
              }`}
            >
              <Button
                variant="destructive-ghost"
                size="icon-sm"
                aria-label={`Remove ${passkey.name}`}
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

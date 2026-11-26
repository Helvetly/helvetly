'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { FormField } from '@helvetly/ui/components/form-field'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Input } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Segmented } from '@helvetly/ui/components/segmented'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Eye, Link2, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { Initials } from '@/components/initials'
import { errorMessage } from '@/lib/api'
import { useStartPortalPreview } from '@/lib/clients'
import {
  createShareLink,
  revokeShareLink,
  shareDocument,
  shareLinkKeys,
  unshareDocument,
  useShareClients,
  useShareLinks,
  useShareMutation,
  useShares,
  type DocFile,
  type DocumentShare,
  type DocumentShareLink,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'

import { KindIcon } from './kind'

const units = { minutes: 60, hours: 3600, days: 86400 } as const
type ExpiryUnit = keyof typeof units

const expiryDate = new Intl.DateTimeFormat(languageTag, { dateStyle: 'medium', timeStyle: 'short' })
const expires = (at: string) =>
  translate('documentShareExpiresAt', { date: expiryDate.format(new Date(at)) })

/** The same share dialog serves cards, menus, previews and client files. */
export function ShareDialog({
  file,
  onClose,
}: {
  file: Pick<DocFile, 'id' | 'name' | 'kind' | 'links'>
  onClose: () => void
}) {
  const [mode, setMode] = useState<'client' | 'link'>('client')
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{translate('documentShareTitle')}</DialogTitle>
          <DialogDescription className="flex min-w-0 items-center gap-2">
            <KindIcon kind={file.kind} className="size-5 rounded-sm [&_svg]:size-3" />
            <span className="truncate" title={file.name}>
              {file.name}
            </span>
          </DialogDescription>
        </DialogHeader>
        <Segmented
          label={translate('documentShareTitle')}
          value={mode}
          options={[
            { value: 'client', label: translate('clientPortal') },
            { value: 'link', label: translate('documentShareLinkMode') },
          ]}
          onChange={setMode}
        />
        <ShareMode mode={mode} file={file} />
      </DialogContent>
    </Dialog>
  )
}

function ShareMode({
  mode,
  file,
}: {
  mode: 'client' | 'link'
  file: Pick<DocFile, 'id' | 'links'>
}) {
  const clientMode = mode === 'client'
  const queryClient = useQueryClient()
  const shares = useShares(file.id, clientMode)
  const clients = useShareClients(clientMode)
  const links = useShareLinks(file.id, !clientMode)
  const [singleUse, setSingleUse] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const [expiry, setExpiry] = useState<'never' | ExpiryUnit>('never')
  const [duration, setDuration] = useState('1')
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null)
  const seconds = expiry === 'never' ? undefined : Number(duration) * units[expiry]
  const valid =
    expiry === 'never' ||
    (/^[0-9]+$/.test(duration) &&
      seconds !== undefined &&
      Number.isSafeInteger(seconds) &&
      seconds > 0 &&
      seconds <= 9_223_372_036)
  const refreshLinks = () => queryClient.invalidateQueries({ queryKey: shareLinkKeys(file.id) })
  const add = useShareMutation(file.id, (clientId: string) =>
    shareDocument(file.id, clientId, seconds),
  )
  const remove = useShareMutation(file.id, (clientId: string) => unshareDocument(file.id, clientId))
  const makeLink = useMutation({
    gcTime: 0,
    mutationFn: async () => {
      const link = await createShareLink(file.id, singleUse, seconds)
      return { id: link.id, url: new URL(`/share#${link.token}`, window.location.origin).href }
    },
    onSuccess: (link) => {
      setCreated(link)
      void refreshLinks()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeShareLink(file.id, id),
    onSuccess: (_, id) => {
      if (created?.id === id) setCreated(null)
      void refreshLinks()
    },
  })
  const shared = new Set(shares.data?.map((share) => share.client_id))
  const options = (clients.data ?? [])
    .filter((client) => !shared.has(client.id))
    .map((client) => ({
      value: client.id,
      label: client.name,
      hint: client.city ?? undefined,
      adornment: <Initials name={client.name} className="size-5 text-micro" />,
    }))
  const linked = file.links.find((link) => link.type === 'client')?.id ?? ''
  const value = chosen ?? (options.some((option) => option.value === linked) ? linked : '')
  const pending = clientMode ? add.isPending : makeLink.isPending
  const error = clientMode
    ? (add.error ?? remove.error ?? shares.error ?? clients.error)
    : (makeLink.error ?? revoke.error ?? links.error)

  return (
    <>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid || pending) return
          if (!clientMode) makeLink.mutate()
          else if (value) add.mutate(value, { onSuccess: () => setChosen(null) })
        }}
      >
        {clientMode && (
          <Combobox
            className="min-w-0 flex-1"
            label={translate('client')}
            value={value}
            options={options}
            searchable
            disabled={options.length === 0 || pending}
            placeholder={
              options.length === 0 ? translate('noClientsToShareWith') : translate('chooseAClient')
            }
            onChange={setChosen}
          />
        )}
        <div className="flex items-end gap-2">
          <FormField id="share-expiry-unit" label={translate('documentShareExpiry')}>
            <Combobox
              id="share-expiry-unit"
              value={expiry}
              options={[
                { value: 'never', label: translate('documentShareNeverExpires') },
                { value: 'minutes', label: translate('documentShareMinutes') },
                { value: 'hours', label: translate('documentShareHours') },
                { value: 'days', label: translate('documentShareDays') },
              ]}
              placeholder={translate('documentShareExpiry')}
              onChange={(next) => setExpiry(next as typeof expiry)}
            />
          </FormField>
          {expiry !== 'never' && (
            <FormField
              id="share-expiry-amount"
              label={translate('documentShareDuration')}
              className="w-28"
            >
              <Input
                id="share-expiry-amount"
                type="number"
                min={1}
                step={1}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                aria-invalid={!valid || undefined}
              />
            </FormField>
          )}
        </div>
        {!clientMode && (
          <>
            <SwitchRow
              label={translate('documentShareSingleUse')}
              checked={singleUse}
              onCheckedChange={setSingleUse}
            />
            <p className="text-body-sm text-muted-foreground">
              {translate(singleUse ? 'documentShareSingleUseHint' : 'documentShareLinkHint')}
            </p>
          </>
        )}
        <Button
          type="submit"
          className="justify-self-start"
          disabled={pending || !valid || (clientMode && !value)}
        >
          {translate(clientMode ? (pending ? 'sharing' : 'share') : 'documentShareCreateLink')}
        </Button>
      </form>
      {error && <InlineError>{errorMessage(error)}</InlineError>}
      {clientMode ? (
        <>
          <section className="grid gap-2" aria-label={translate('sharedWith')}>
            <h3 className="text-body-sm font-medium">{translate('sharedWith')}</h3>
            {shares.data?.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                {translate('notSharedWithAnyClientYet')}
              </p>
            ) : (
              <ul className="grid gap-1">
                {shares.data?.map((share) => (
                  <ShareRow
                    key={share.client_id}
                    share={share}
                    removing={remove.isPending}
                    onRemove={() => remove.mutate(share.client_id)}
                  />
                ))}
              </ul>
            )}
          </section>
          <p className="flex flex-wrap items-center gap-x-2 text-body-sm text-muted-foreground">
            {translate('clientsSeeSharedFilesInTheirPortal')}
            {shares.data?.length === 1 && shares.data[0] && (
              <ViewAsClientLink clientId={shares.data[0].client_id} />
            )}
          </p>
        </>
      ) : (
        <>
          {created && (
            <div className="grid gap-1.5">
              <div className="flex gap-2">
                <Input
                  aria-label={translate('documentShareLinkMode')}
                  value={created.url}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(created.url).then(
                      () => toast.success(translate('linkCopied')),
                      () => toast.error(translate('documentShareCopyFailed')),
                    )
                  }}
                >
                  <Copy />
                  {translate('copyLink')}
                </Button>
              </div>
              <p className="text-body-sm text-muted-foreground">
                {translate('documentShareSaveLink')}
              </p>
            </div>
          )}
          {links.data && links.data.length > 0 && (
            <section className="grid gap-1.5" aria-label={translate('documentShareLinks')}>
              <h3 className="text-body-sm font-medium">{translate('documentShareLinks')}</h3>
              <ul className="-m-1 grid max-h-38 gap-1 overflow-y-auto p-1">
                {links.data.map((link) => (
                  <ShareLinkRow
                    key={link.id}
                    link={link}
                    pending={revoke.isPending}
                    onRemove={() => revoke.mutate(link.id)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  )
}

function ShareLinkRow({
  link,
  pending,
  onRemove,
}: {
  link: DocumentShareLink
  pending: boolean
  onRemove: () => void
}) {
  const [openedAt] = useState(() => Date.now())
  const expired = link.expires_at && new Date(link.expires_at).getTime() <= openedAt
  const status = link.used_at
    ? translate('documentShareLinkUsed')
    : expired
      ? translate('documentShareLinkExpired')
      : link.expires_at
        ? expires(link.expires_at)
        : translate('documentShareNeverExpires')
  const title = translate(link.single_use ? 'documentShareSingleUse' : 'documentShareLinkMode')
  return (
    <li className="flex min-w-0 items-center gap-2.5 rounded-lg py-1 text-body-sm">
      <Link2 aria-hidden className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {translate('documentShareLinkCreatedAt', {
            date: expiryDate.format(new Date(link.created_at)),
          })}{' '}
          · {status}
        </span>
      </span>
      <Button variant="ghost" size="sm" disabled={pending} onClick={onRemove}>
        {translate('documentShareRevokeLink')}
      </Button>
    </li>
  )
}

function ShareRow({
  share,
  removing,
  onRemove,
}: {
  share: DocumentShare
  removing: boolean
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="flex min-w-0 items-center gap-2.5 rounded-lg py-1 text-body-sm">
      <Initials name={share.client_name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate" title={share.client_name}>
          {share.client_name}
        </span>
        <span className="block text-xs text-muted-foreground">
          {share.expires_at
            ? expires(share.expires_at)
            : translate('sharedSince', { date: formatDate(share.shared_at) })}
        </span>
      </span>
      <Popover open={confirming} onOpenChange={setConfirming}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={translate('remove6', { client_name: share.client_name })}
            disabled={removing}
          >
            {translate('remove')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="grid w-64 gap-3 p-3">
          <p className="text-body-sm">
            {translate('stopSharingWith', { client_name: share.client_name })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
              {translate('cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirming(false)
                onRemove()
              }}
            >
              <Trash2 />
              {translate('remove')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </li>
  )
}

/** The client's portal, read-only in a new tab (the preview of the client's page). */
function ViewAsClientLink({ clientId }: { clientId: string }) {
  const start = useStartPortalPreview()
  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      className="h-auto px-0"
      disabled={start.isPending}
      onClick={() => {
        // The tab opens at the click, so no popup blocker stops it; the link follows once the API made it.
        const tab = window.open('', '_blank')
        if (tab) tab.opener = null
        start.mutate(clientId, {
          onSuccess: (url) => {
            if (tab) tab.location.href = url
            else window.open(url, '_blank', 'noopener')
          },
          onError: (failure) => {
            tab?.close()
            toastError(failure)
          },
        })
      }}
    >
      <Eye />
      {translate('viewAsClient')}
    </Button>
  )
}

export const isShared = (file: Pick<DocFile, 'shared_with'>) => (file.shared_with?.length ?? 0) > 0

/** The one "Share with client" icon button (list row, grid card and preview), labelled by a tooltip; filled while the
 *  file is shared, naming with whom. */
export function ShareButton({
  file,
  onOpen,
}: {
  file: Pick<DocFile, 'name' | 'shared_with'>
  onOpen: () => void
}) {
  const shared = file.shared_with ?? []
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-shared={shared.length > 0 || undefined}
            aria-label={translate('documentShareAction', { name: file.name })}
            aria-pressed={shared.length > 0}
            onClick={(event) => {
              event.stopPropagation()
              onOpen()
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className="relative z-[1] text-foreground/75 hover:text-foreground data-shared:bg-brand-surface data-shared:text-brand"
          >
            <Share2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {shared.length
            ? translate('sharedWithClient', {
                client: shared.map((share) => share.client_name).join(', '),
              })
            : translate('documentShareTitle')}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

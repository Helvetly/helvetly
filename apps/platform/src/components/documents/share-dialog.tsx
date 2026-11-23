'use client'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { Eye, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { toastError } from '@/components/billing/upgrade-prompt'
import { Initials } from '@/components/initials'
import { errorMessage } from '@/lib/api'
import { useStartPortalPreview } from '@/lib/clients'
import {
  shareDocument,
  unshareDocument,
  useShareClients,
  useShareMutation,
  useShares,
  type DocFile,
  type DocumentShare,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'

import { KindIcon } from './kind'

/**
 * Who a file is shared with in the client portal, as one modal from every entry point (card, menus, preview, client
 * files): pick a client and Share (Enter does it), remove one after a confirmation.
 */
export function ShareDialog({
  file,
  onClose,
}: {
  file: Pick<DocFile, 'id' | 'name' | 'kind' | 'links'>
  onClose: () => void
}) {
  const shares = useShares(file.id)
  const clients = useShareClients()
  const add = useShareMutation(file.id, (clientId) => shareDocument(file.id, clientId))
  const remove = useShareMutation(file.id, (clientId) => unshareDocument(file.id, clientId))
  // The client the file is linked to is the likely audience.
  const linked = file.links.find((link) => link.type === 'client')?.id ?? ''
  const [chosen, setChosen] = useState<string | null>(null)

  const shared = new Set(shares.data?.map((share) => share.client_id))
  const options = (clients.data ?? [])
    .filter((client) => !shared.has(client.id))
    .map((client) => ({
      value: client.id,
      label: client.name,
      hint: client.city ?? undefined,
      adornment: <Initials name={client.name} className="size-5 text-micro" />,
    }))
  const value = chosen ?? (options.some((option) => option.value === linked) ? linked : '')
  const error = add.error ?? remove.error ?? shares.error ?? clients.error
  const submit = () => {
    if (value && !add.isPending) add.mutate(value, { onSuccess: () => setChosen(null) })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{translate('shareWithClient2')}</DialogTitle>
          <DialogDescription className="flex min-w-0 items-center gap-2">
            <KindIcon kind={file.kind} className="size-5 rounded-sm [&_svg]:size-3" />
            <span className="truncate" title={file.name}>
              {file.name}
            </span>
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Combobox
            className="min-w-0 flex-1"
            label={translate('client')}
            value={value}
            options={options}
            searchable
            disabled={options.length === 0 || add.isPending}
            placeholder={
              options.length === 0 ? translate('noClientsToShareWith') : translate('chooseAClient')
            }
            onChange={setChosen}
          />
          <Button type="submit" disabled={!value || add.isPending}>
            {add.isPending ? translate('sharing') : translate('share')}
          </Button>
        </form>
        {error && <InlineError>{errorMessage(error)}</InlineError>}
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
      </DialogContent>
    </Dialog>
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
          {translate('sharedSince', { date: formatDate(share.shared_at) })}
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
            aria-label={translate('shareWithAClient', { name: file.name })}
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
            : translate('shareWithClient2')}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

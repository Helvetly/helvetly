'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@helvetly/ui/components/sheet'
import { formatDate } from '@helvetly/ui/lib/format'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { errorMessage } from '@/lib/api'
import {
  shareDocument,
  unshareDocument,
  useShareClients,
  useShareMutation,
  useShares,
  type DocFile,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'

/** Who a document is shared with in the client portal: add a client, remove one. */
export function ShareDrawer({ file, onClose }: { file: DocFile; onClose: () => void }) {
  const shares = useShares(file.id)
  const clients = useShareClients()
  const add = useShareMutation(file.id, (clientId) => shareDocument(file.id, clientId))
  const remove = useShareMutation(file.id, (clientId) => unshareDocument(file.id, clientId))
  // The client the file is linked to is the likely audience.
  const linked = file.links.find((link) => link.type === 'client')?.id ?? ''
  const [chosen, setChosen] = useState<string | null>(null)

  const shared = new Set(shares.data?.map((share) => share.client_id))
  const options = (clients.data ?? []).filter((client) => !shared.has(client.id))
  const value = chosen ?? (options.some((client) => client.id === linked) ? linked : '')
  const error = add.error ?? remove.error ?? shares.error ?? clients.error

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{translate('shareWithClient2')}</SheetTitle>
          <SheetDescription>{file.name}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 px-4 pb-4">
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (value) add.mutate(value, { onSuccess: () => setChosen(null) })
            }}
          >
            <label htmlFor="share-client" className="text-sm font-medium">
              {translate('client')}
            </label>
            <div className="flex gap-2">
              <select
                id="share-client"
                value={value}
                disabled={options.length === 0 || add.isPending}
                onChange={(event) => setChosen(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
              >
                <option value="">
                  {options.length === 0
                    ? translate('noClientsToShareWith')
                    : translate('chooseAClient')}
                </option>
                {options.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={!value || add.isPending}>
                {add.isPending ? translate('sharing') : translate('share')}
              </Button>
            </div>
          </form>
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {errorMessage(error)}
            </p>
          )}
          <section className="grid gap-2" aria-label={translate('sharedWith')}>
            <h3 className="text-sm font-medium">{translate('sharedWith')}</h3>
            {shares.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">{translate('notSharedWithAnyoneYet')}</p>
            )}
            <ul className="grid gap-1">
              {shares.data?.map((share) => (
                <li key={share.client_id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{share.client_name}</span>
                  <span className="text-muted-foreground">{formatDate(share.shared_at)}</span>
                  <Button
                    variant="destructive-ghost"
                    size="sm"
                    aria-label={translate('remove6', { client_name: share.client_name })}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(share.client_id)}
                  >
                    <Trash2 />
                    {translate('remove')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

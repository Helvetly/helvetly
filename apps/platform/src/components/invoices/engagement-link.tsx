'use client'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'

import { Combobox } from '@/components/clients/fields'
import { EngagementForm } from '@/components/engagements/engagement-form'
import { errorMessage } from '@/lib/api'
import {
  linkInvoice,
  unlinkInvoice,
  useClientEngagements,
  useInvoiceEngagement,
} from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { queryKeys } from '@/lib/queries'

import { quietValue } from './date-fields'

/**
 * The engagement an invoice is billed under. Choosing one attaches a saved draft at once; before the draft exists
 * the choice waits in `pending` for the editor to link after its first save. A new engagement is created in place
 * and linked the same way.
 */
export function EngagementLink({
  id,
  clientId,
  invoiceId,
  pending,
  onPendingChange,
}: {
  id: string
  clientId: string
  invoiceId: string | null
  pending: string
  onPendingChange: (engagementId: string) => void
}) {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const create = (title: string) => {
    setNewTitle(title)
    setCreating(true)
  }
  const linked = useInvoiceEngagement(invoiceId).data
  const engagements = useClientEngagements(clientId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.engagements })
  const link = useMutation({
    mutationFn: (engagement: { id: string; title: string }) =>
      linkInvoice(engagement.id, invoiceId ?? ''),
    onSuccess: (_, { title }) => {
      toast.success(translate('linkedToEngagement', { title }))
      void refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const unlink = useMutation({
    mutationFn: () => unlinkInvoice(linked?.id ?? '', invoiceId ?? ''),
    onSuccess: () => {
      toast.success(translate('removedFromTheEngagement'))
      void refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (linked)
    return (
      <span className={cn(quietValue, 'justify-between')}>
        <Link
          href={`/engagements?id=${encodeURIComponent(linked.id)}`}
          className="truncate underline underline-offset-2"
        >
          {linked.title}
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={unlink.isPending}
              aria-label={translate('removeFromEngagement')}
              onClick={() => unlink.mutate()}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translate('removeFromEngagement')}</TooltipContent>
        </Tooltip>
      </span>
    )

  const options = (engagements.data ?? []).map((e) => ({ value: e.id, label: e.title }))
  const choose = (engagement: { id: string; title: string }) => {
    if (invoiceId) link.mutate(engagement)
    else onPendingChange(engagement.id === pending ? '' : engagement.id)
  }
  const none = clientId !== '' && options.length === 0 && !engagements.isPending
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {none ? (
        <Button
          id={id}
          type="button"
          variant="ghost"
          size="xs"
          className="-ml-2 gap-1 text-muted-foreground"
          onClick={() => create('')}
        >
          <Plus />
          {translate('newEngagement2')}
        </Button>
      ) : (
        <>
          <Combobox
            id={id}
            value={pending}
            options={options}
            disabled={!clientId || options.length === 0 || link.isPending}
            placeholder={translate('chooseAnEngagement')}
            onCreate={clientId ? create : undefined}
            createLabel={translate('newEngagement2')}
            onChange={(next) =>
              choose({ id: next, title: options.find((o) => o.value === next)?.label ?? '' })
            }
            // Quiet like the other meta values: no field box. Muted, not placeholder grey: a button needs the contrast.
            className={cn(
              quietValue,
              'min-w-0 flex-1 justify-start border-transparent bg-transparent shadow-none hover:border-transparent dark:border-transparent dark:bg-transparent [&>svg]:hidden',
            )}
          />
        </>
      )}
      <EngagementForm
        open={creating}
        onOpenChange={setCreating}
        title={newTitle}
        clientId={clientId}
        onSaved={(engagement) => {
          void refresh()
          choose({ id: engagement.id, title: engagement.title })
        }}
      />
    </div>
  )
}

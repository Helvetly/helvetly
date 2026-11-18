'use client'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

import { Combobox } from '@/components/clients/fields'
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
 * the choice waits in `pending` for the editor to link after its first save.
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
  const linked = useInvoiceEngagement(invoiceId).data
  const engagements = useClientEngagements(clientId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.engagements })
  const link = useMutation({
    mutationFn: (engagementId: string) => linkInvoice(engagementId, invoiceId ?? ''),
    onSuccess: (_, engagementId) => {
      const title = engagements.data?.find((e) => e.id === engagementId)?.title ?? ''
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
  return (
    <Combobox
      id={id}
      value={pending}
      options={options}
      disabled={!clientId || options.length === 0 || link.isPending}
      placeholder={
        clientId && options.length === 0 && !engagements.isPending
          ? translate('noActiveEngagements')
          : translate('chooseAnEngagement')
      }
      onChange={(next) => {
        if (invoiceId) link.mutate(next)
        else onPendingChange(next === pending ? '' : next)
      }}
      // Quiet like the other meta values: no field box, the placeholder colour until something is chosen.
      className={cn(
        quietValue,
        'justify-start border-transparent bg-transparent shadow-none hover:border-transparent dark:border-transparent dark:bg-transparent [&>svg]:hidden',
        !pending && '[&>span]:text-placeholder',
      )}
    />
  )
}

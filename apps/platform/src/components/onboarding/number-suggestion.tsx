'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { invoiceKeys, invoicesApi, type NumberFormat } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'

/** After an import into a workspace that has issued no invoice yet: offer the numbering its imported invoices follow,
 * continuing after the last of them. `imported` changes with each import, which asks again. */
export function NumberSuggestion({
  imported,
  onApplied,
}: {
  imported: string
  onApplied: (format: NumberFormat) => void
}) {
  const queryClient = useQueryClient()
  const canEdit = useCan('write:invoice-settings')
  const suggestion = useQuery({
    queryKey: [...invoiceKeys.settings, 'number-suggestion', imported],
    queryFn: invoicesApi.numberSuggestion,
    enabled: canEdit,
  })
  const [dismissed, setDismissed] = useState<string | null>(null)
  const apply = useMutation({
    mutationFn: invoicesApi.applyNumberSuggestion,
    onSuccess: (settings) => {
      queryClient.setQueryData(invoiceKeys.settings, settings)
      onApplied(settings.number_format)
    },
  })
  const offer = suggestion.data
  if (apply.isSuccess && offer)
    return (
      <Callout tone="success">{translate('numberSuggestionApplied', { next: offer.next })}</Callout>
    )
  if (!offer || dismissed === imported) return null
  return (
    <Callout tone="info" title={translate('numberSuggestionTitle')}>
      {translate('numberSuggestionText', { format: offer.format, next: offer.next })}
      {apply.isError && (
        <p role="alert" className="mt-1 text-destructive">
          {errorMessage(apply.error)}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button type="button" disabled={apply.isPending} onClick={() => apply.mutate()}>
          {translate('useThisFormat')}
        </Button>
        <Button type="button" variant="outline" onClick={() => setDismissed(imported)}>
          {translate('keepMyFormat')}
        </Button>
      </div>
    </Callout>
  )
}

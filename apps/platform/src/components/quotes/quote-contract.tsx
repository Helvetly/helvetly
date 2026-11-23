'use client'
import { Button } from '@helvetly/ui/components/button'
import { Panel } from '@helvetly/ui/components/panel'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { FileSignature, ScrollText } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { ContractWriter } from '@/components/quotes/contract-writer'
import { useOpenHref } from '@/components/record-link'
import { ContractSignDrawer } from '@/components/signatures/create-drawer'
import { RequestBadge } from '@/components/signatures/parts'
import { FillTemplateDrawer } from '@/components/templates/fill-drawer'
import { useAI } from '@/lib/ai'
import { useClient } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import type { Quote } from '@/lib/quotes'
import { useQuoteContracts, type Generated, type Template } from '@/lib/templates'

const documentHref = (id: string) => `/documents?${new URLSearchParams({ file: id })}`

/**
 * "Create contract": written by the AI from the quote (alone or after an example contract), an example used as it
 * is, or a template filled from it; then the numbered contract is filed in the client's Contracts folder. The toast
 * offers sending it for signature and opening it.
 */
export function ContractFlow({
  quote,
  onClose,
  onSign,
}: {
  quote: Quote
  onClose: () => void
  /** The toast's "Send for signature": the host opens it, this flow is closed by then. */
  onSign: (documentId: string) => void
}) {
  const openHref = useOpenHref()
  const client = useClient(quote.client.id).data ?? null
  // Without AI on the installation "Create contract" fills a template.
  const ai = useAI()
  const [template, setTemplate] = useState<Template | null>(null)

  const made = (data: Generated) => {
    const number = data.contract_number ?? data.document.name
    if (data.signature_request_id) {
      toast.success(translate('contractSentForSignature', { number }))
      return onClose()
    }
    toast.success(translate('contractCreated', { number }), {
      action: {
        label: translate('sendForSignature2'),
        onClick: () => onSign(data.document.id),
      },
      cancel: { label: translate('open'), onClick: () => openHref(documentHref(data.document.id)) },
    })
    onClose()
  }

  if (!client) return null
  if (!template && ai.available)
    return (
      <ContractWriter
        quote={quote}
        client={client}
        onTemplate={setTemplate}
        onMade={made}
        onPlace={(data) => {
          toast.success(translate('savedToDocuments', { name: data.document.name }))
          onSign(data.document.id)
        }}
        onClose={onClose}
      />
    )
  return (
    <FillTemplateDrawer
      template={template}
      start={template !== null}
      client={client}
      contract={{ quoteId: quote.id, quoteNumber: quote.number, onMade: made }}
      onClose={onClose}
    />
  )
}

/** The quote's contracts, newest first: number, date, signature status, Open and Send for signature. */
export function ContractSection({ quote, writable }: { quote: Quote; writable: boolean }) {
  const openHref = useOpenHref()
  const contracts = useQuoteContracts(quote.id).data ?? []
  const [signing, setSigning] = useState<string | null>(null)
  if (contracts.length === 0) return null
  return (
    <Panel title={contracts.length > 1 ? translate('contracts') : translate('contract')}>
      <ul className="divide-y divide-border/60">
        {contracts.map((contract) => {
          // a declined, revoked or expired request may be sent again
          const status = contract.signature?.status
          const signable = writable && status !== 'pending' && status !== 'completed'
          return (
            <li
              key={contract.document_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 first:pt-0.5"
            >
              <ScrollText className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
              <span className="grid min-w-0 flex-1">
                <span className="font-code truncate text-body">{contract.number}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {translate('createdOn', { date: formatDate(contract.created_at) })}
                </span>
              </span>
              {contract.signature && <RequestBadge status={contract.signature.status} />}
              <span className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openHref(documentHref(contract.document_id))}
                >
                  {translate('open')}
                </Button>
                {signable && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setSigning(contract.document_id)}
                  >
                    <FileSignature className="size-3.5" />
                    {translate('sendForSignature2')}
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {signing && <ContractSignDrawer documentId={signing} onClose={() => setSigning(null)} />}
    </Panel>
  )
}

/** A quote row's quiet mark that it has contracts. */
export function ContractMark({ count }: { count: number | undefined }) {
  if (!count) return null
  const label = translate('quoteHasContracts', { count })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ScrollText
          aria-label={label}
          className="size-3.5 shrink-0 stroke-[1.75] text-muted-foreground"
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

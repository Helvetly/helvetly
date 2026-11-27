'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Combobox } from '@helvetly/ui/components/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { FormField } from '@helvetly/ui/components/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { ClientSearch } from '@/components/invoices/client-search'
import { errorMessage } from '@/lib/api'
import {
  clientKeys,
  clientsApi,
  useClient,
  useSaveClient,
  type Client,
  type MergeResult,
} from '@/lib/clients'
import { translate } from '@/lib/i18n'

import { inputClass } from './fields'

/** The counts a merge moves, as lines for the person; zero counts are left out. */
export function mergeLines(counts: MergeResult['counts']): string[] {
  const lines: [number, string][] = [
    [counts.invoices, translate('mergeInvoices', { count: counts.invoices })],
    [counts.quotes, translate('mergeQuotes', { count: counts.quotes })],
    [counts.engagements, translate('mergeEngagements', { count: counts.engagements })],
    [counts.sessions, translate('mergeSessions', { count: counts.sessions })],
    [counts.documents, translate('mergeDocuments', { count: counts.documents })],
  ]
  return lines.filter(([count]) => count > 0).map(([, line]) => line)
}

/**
 * "Make participant of…": a person client becomes a participant of a company client. Pick the company and, if
 * wanted, the person there (else matched by email or name, or added); a dry run says what moves, Confirm moves it
 * and deletes the emptied person client. Issued invoices keep their buyer and PDF.
 */
export function MakeParticipantDialog({
  client,
  onClose,
  onDone,
}: {
  client: Client
  onClose: () => void
  /** After the move: the company to show instead of the deleted person client. */
  onDone: (companyId: string) => void
}) {
  const queryClient = useQueryClient()
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null)
  const [participantId, setParticipantId] = useState('')
  const [open, setOpen] = useState(false)
  const [moved, setMoved] = useState<MergeResult | null>(null)
  const companyRecord = useClient(company?.id ?? null)
  const saveClient = useSaveClient()
  const preview = useQuery({
    queryKey: ['clients', client.id, 'make-participant', company?.id, participantId],
    queryFn: async () =>
      (
        await clientsApi.makeParticipant(client.id, {
          company_id: company?.id ?? '',
          participant_id: participantId || undefined,
          dry_run: true,
        })
      ).data,
    enabled: Boolean(company),
    retry: false,
  })
  const confirm = useMutation({
    mutationFn: async () =>
      (
        await clientsApi.makeParticipant(client.id, {
          company_id: company?.id ?? '',
          participant_id: participantId || undefined,
          dry_run: false,
        })
      ).data,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: clientKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      toast.success(
        translate('madeParticipantOf', { name: client.name, company: company?.name ?? '' }),
      )
      if (result.suggest_participants_mode) setMoved(result)
      else onDone(result.company_id)
    },
    onError: toastError,
  })
  const people = companyRecord.data?.contacts ?? []
  const match = preview.data
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate('makeParticipantOfTitle', { name: client.name })}</DialogTitle>
          <DialogDescription>{translate('makeParticipantOfText')}</DialogDescription>
        </DialogHeader>
        {moved ? (
          <Callout tone="info" title={translate('switchToParticipantsTitle')}>
            {translate('switchToParticipantsText', { company: company?.name ?? '' })}
          </Callout>
        ) : (
          <div className="grid gap-4">
            <FormField id="merge-company" label={translate('companyClient')}>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="merge-company"
                    type="button"
                    variant="ghost"
                    className={cn(inputClass, 'justify-between text-left font-normal')}
                  >
                    <span className={cn('truncate', !company && 'text-muted-foreground')}>
                      {company?.name ?? translate('chooseACompany')}
                    </span>
                    <ChevronsUpDown className="text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0">
                  <ClientSearch
                    selectedId={company?.id ?? null}
                    onSelect={(picked) => {
                      setOpen(false)
                      setCompany({ id: picked.id, name: picked.name })
                      setParticipantId('')
                    }}
                  />
                </PopoverContent>
              </Popover>
            </FormField>
            {company && (
              <FormField id="merge-person" label={translate('personAtCompany')}>
                <Combobox
                  id="merge-person"
                  label={translate('personAtCompany')}
                  value={participantId}
                  options={people.map((person) => ({
                    value: person.id,
                    label: person.name,
                    hint: person.email ?? undefined,
                  }))}
                  onChange={setParticipantId}
                  onClear={() => setParticipantId('')}
                  clearLabel={translate('matchOrAddPerson')}
                  placeholder={translate('matchOrAddPerson')}
                />
              </FormField>
            )}
            {preview.isError && (
              <p role="alert" className="text-body-sm text-destructive">
                {errorMessage(preview.error)}
              </p>
            )}
            {match && (
              <div className="grid gap-1 rounded-lg bg-muted/60 px-3 py-2.5 text-body-sm">
                <span>
                  {match.match === 'new'
                    ? translate('mergeAddsPerson', { name: client.name })
                    : translate('mergeMatchesPerson', {
                        name:
                          people.find((person) => person.id === match.participant_id)?.name ??
                          client.name,
                      })}
                </span>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {mergeLines(match.counts).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <span className="text-caption text-muted-foreground">
                  {translate('mergeKeepsIssued')}
                </span>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {moved ? (
            <>
              <Button variant="ghost" onClick={() => onDone(moved.company_id)}>
                {translate('notNow')}
              </Button>
              <Button
                disabled={saveClient.isPending}
                onClick={() =>
                  saveClient.mutate(
                    { id: moved.company_id, input: { documents_to: 'participants' } },
                    { onSuccess: () => onDone(moved.company_id), onError: toastError },
                  )
                }
              >
                {translate('switchToParticipants')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {translate('cancel')}
              </Button>
              <Button disabled={!match || confirm.isPending} onClick={() => confirm.mutate()}>
                {translate('makeParticipant')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

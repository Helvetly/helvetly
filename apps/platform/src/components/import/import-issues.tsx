'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { TriangleAlert, UserRound } from 'lucide-react'
import { useState } from 'react'

import { ClientSearch } from '@/components/invoices/client-search'
import { errorMessage } from '@/lib/api'
import type { Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import {
  IMPORT_KINDS,
  isSettled,
  usePatchImportRecord,
  type ImportKindConfig,
  type ImportRecord,
} from '@/lib/imports'

export const issuesId = (record: ImportRecord) => `${record.id}-issues`

/** "Client: No client matches…" for each flagged field. */
const issueLines = (config: ImportKindConfig, record: ImportRecord) =>
  Object.entries(record.issues).map(
    ([field, message]) => `${config.fields[field] ?? field}: ${message}`,
  )

/** One calm badge per flagged row instead of red text; its tooltip lists what is wrong and a click opens the fix. */
export function IssueChip({
  id,
  config,
  record,
  onFix,
}: {
  id: string
  config: ImportKindConfig
  record: ImportRecord
  onFix: () => void
}) {
  const lines = issueLines(config, record)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={`${translate('importNeedsFix')}: ${lines.join('. ')}`}
          onClick={onFix}
          className="inline-flex items-center gap-1 rounded-full bg-warning-surface px-2 py-0.5 text-caption font-medium text-warning ring-1 ring-warning-border transition-colors ring-inset hover:bg-warning-surface/70 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <TriangleAlert className="size-3" />
          {translate('importNeedsFix')}
          {lines.length > 1 && <span className="tabular-nums">· {lines.length}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="grid gap-0.5">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-1 opacity-80">{translate('importFixHint')}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** Above the tables: how many rows need a client or a fix, with the quickest way to deal with them. */
export function IssueSummary({
  batchId,
  records,
  onEdit,
  onFixed,
}: {
  batchId: string
  records: ImportRecord[]
  onEdit: (id: string) => void
  /** Rows a bulk fix made clean again, to be ticked. */
  onFixed: (saved: ImportRecord[]) => void
}) {
  const patch = usePatchImportRecord(batchId)
  const [picking, setPicking] = useState(false)
  const open = records.filter((record) => !isSettled(record))
  const needClient = open.filter(
    (record) => 'pickClient' in IMPORT_KINDS[record.kind] && record.issues.client_id,
  )
  const needFix = open.filter((record) =>
    Object.keys(record.issues).some((field) => field !== 'client_id'),
  )

  const chooseForAll = async (client: Client) => {
    setPicking(false)
    try {
      const saved = await Promise.all(
        needClient.map((record) =>
          patch.mutateAsync({
            recordId: record.id,
            data: { client_id: client.id, client_name: client.name },
          }),
        ),
      )
      onFixed(saved)
    } catch {
      // the error shows under the callout; rows already saved stay saved
    }
  }

  if (!needClient.length && !needFix.length) return null
  const first = needFix[0]
  return (
    <div className="grid gap-2">
      {needClient.length > 0 && (
        <Callout
          tone="warning"
          icon={UserRound}
          title={translate('importRowsNeedClient', { count: needClient.length })}
          actions={
            <Popover open={picking} onOpenChange={setPicking}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" disabled={patch.isPending}>
                  {translate('importChooseClientForAll')}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(380px,calc(100vw-2rem))] p-0">
                <ClientSearch selectedId={null} onSelect={(client) => void chooseForAll(client)} />
              </PopoverContent>
            </Popover>
          }
        >
          {translate('importRowsNeedClientBody')}
        </Callout>
      )}
      {first && (
        <Callout
          tone="warning"
          title={translate('importRowsNeedFix', { count: needFix.length })}
          actions={
            <Button size="sm" variant="outline" onClick={() => onEdit(first.id)}>
              {translate('importFixFirst')}
            </Button>
          }
        >
          {translate('importRowsNeedFixBody')}
        </Callout>
      )}
      {patch.error && (
        <p role="alert" className="text-caption text-destructive">
          {errorMessage(patch.error)}
        </p>
      )}
    </div>
  )
}

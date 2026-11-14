'use client'

import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import Link from 'next/link'
import { useState } from 'react'

import {
  applyToAll,
  displayValue,
  type ImportConflict,
  type ImportKindConfig,
  type ImportRecord,
  type Resolution,
} from '@/lib/imports'

export type Conflict = { id: string; conflict: ImportConflict }

/**
 * Records that collide with existing ones (an invoice number already used): the person chooses per row to overwrite
 * the existing record or skip the row, or applies one choice to all. Skip is the default; overwrite is offered only
 * where the server allows it, with the reason when it does not.
 */
export function ImportConflicts({
  config,
  records,
  conflicts,
  pending,
  onConfirm,
  onCancel,
}: {
  config: ImportKindConfig
  records: ImportRecord[]
  conflicts: Conflict[]
  pending: boolean
  onConfirm: (resolutions: Record<string, Resolution>) => void
  onCancel: () => void
}) {
  const [choices, setChoices] = useState(() => applyToAll(conflicts, 'skip'))
  const anyOverwritable = conflicts.some(({ conflict }) => conflict.can_overwrite)
  const count = conflicts.length
  const name = (id: string) => {
    const record = records.find((entry) => entry.id === id)
    return record ? displayValue(record.data[config.labelKey ?? 'name']) : ''
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-none! gap-4">
        <DialogHeader>
          <DialogTitle>
            {count === 1 ? 'This number is already used' : `${count} numbers are already used`}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {count === 1 ? 'An invoice with this number' : 'Invoices with these numbers'} already
            exist in Helvetly. Choose for each row: overwrite the existing invoice with the imported
            one, or skip the row.
          </DialogDescription>
        </DialogHeader>

        {count > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <span>Apply to all:</span>
            <Button
              size="sm"
              variant="outline"
              disabled={!anyOverwritable}
              onClick={() => setChoices(applyToAll(conflicts, 'overwrite'))}
            >
              Overwrite all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setChoices(applyToAll(conflicts, 'skip'))}
            >
              Skip all
            </Button>
          </div>
        )}

        <ul
          aria-label="Conflicts"
          className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border"
        >
          {conflicts.map(({ id, conflict }) => {
            const label = name(id) || conflict.label
            const choice = choices[id] ?? 'skip'
            return (
              <li key={id} className="grid gap-2 px-3 py-2.5 text-[13px] sm:grid-cols-[1fr_auto]">
                <div className="grid min-w-0 gap-0.5">
                  <span className="truncate font-medium">{label}</span>
                  <span className="text-muted-foreground">
                    Already used by{' '}
                    <Link
                      href={config.entityHref(conflict.id)}
                      target="_blank"
                      className="underline underline-offset-2"
                    >
                      {conflict.label}
                    </Link>
                  </span>
                  {conflict.why_not && (
                    <span className="text-[12px] text-pretty text-muted-foreground">
                      Cannot be overwritten: {conflict.why_not}
                    </span>
                  )}
                </div>
                <fieldset aria-label={`Choice for ${label}`} className="flex gap-1 self-start">
                  {(['overwrite', 'skip'] as const).map((option) => (
                    <Button
                      key={option}
                      size="sm"
                      variant={choice === option ? 'default' : 'outline'}
                      aria-pressed={choice === option}
                      aria-label={`${option === 'overwrite' ? 'Overwrite' : 'Skip'} ${label}`}
                      disabled={option === 'overwrite' && !conflict.can_overwrite}
                      onClick={() => setChoices((current) => ({ ...current, [id]: option }))}
                    >
                      {option === 'overwrite' ? 'Overwrite' : 'Skip'}
                    </Button>
                  ))}
                </fieldset>
              </li>
            )
          })}
        </ul>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Decide later
          </Button>
          <Button disabled={pending} onClick={() => onConfirm(choices)}>
            {pending ? 'Importing…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

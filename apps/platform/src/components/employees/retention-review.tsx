'use client'

import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { Info, X } from 'lucide-react'

import { loadProblemText } from '@/components/data/load-problem'
import { documentTypeLabel, useRetentionReview, type RetentionItem } from '@/lib/employees'
import { translate } from '@/lib/i18n'

const BLOCKED: Record<NonNullable<RetentionItem['blocked_by']>, string> = {
  legal_hold: translate('employeeRetentionBlockedHold'),
  erased: translate('employeeRetentionBlockedErased'),
  restricted: translate('employeeRetentionBlockedRestricted'),
}

/**
 * The owner's dry run of erasure after retention: for each former employee, what erasing them would delete today.
 * It changes nothing; erasing stays a decision on the employee's record.
 */
export function RetentionReview({
  onClose,
  onOpen,
}: {
  onClose: () => void
  onOpen: (employeeId: string) => void
}) {
  const query = useRetentionReview(true)
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(640px,100vw)]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{translate('employeeRetentionTitle')}</SheetTitle>
        <SheetDescription className="sr-only">
          {translate('employeeRetentionDescription')}
        </SheetDescription>
        <header className="flex items-center gap-3 border-b px-5 py-4 md:px-6">
          <h2 className="flex-1 truncate text-lg font-semibold">
            {translate('employeeRetentionTitle')}
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate('close')}
                onClick={onClose}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('close')}</TooltipContent>
          </Tooltip>
        </header>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-5 md:p-6">
          <Callout tone="info" icon={Info}>
            {translate('employeeRetentionExplain')}
          </Callout>
          {query.error ? (
            <p className="text-body-sm text-muted-foreground">
              {loadProblemText(query.error, translate('employeeRetentionTitle'))}
            </p>
          ) : !query.data ? (
            <Loader className="h-24" />
          ) : query.data.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">
              {translate('employeeRetentionNone')}
            </p>
          ) : (
            <ul
              aria-label={translate('employeeRetentionFormer')}
              className="grid divide-y rounded-lg ring-1 ring-border"
            >
              {query.data.map((item) => (
                <li key={item.employee_id} className="grid gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(item.employee_id)}
                      className="cursor-pointer text-left text-title-sm underline underline-offset-2"
                    >
                      {item.name}
                    </button>
                    <span className="text-body-sm text-muted-foreground">
                      {translate('employeeRetentionEnded', {
                        date: formatDate(item.employment_end),
                      })}
                    </span>
                    {item.blocked_by && (
                      <Badge tone={item.blocked_by === 'erased' ? 'neutral' : 'amber'}>
                        {BLOCKED[item.blocked_by]}
                      </Badge>
                    )}
                  </div>
                  {item.blocked_by !== 'erased' &&
                    (item.documents_due.length > 0 ? (
                      <div className="grid gap-1 text-body-sm">
                        <span>
                          {translate('employeeRetentionWouldDelete', {
                            count: item.documents_due.length,
                          })}
                        </span>
                        <ul className="grid gap-0.5 pl-4 text-muted-foreground">
                          {item.documents_due.map((doc) => (
                            <li key={doc.id} className="list-disc">
                              {doc.name} · {documentTypeLabel(doc.type)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <span className="text-body-sm text-muted-foreground">
                        {translate('employeeRetentionNothingDue')}
                      </span>
                    ))}
                  {item.documents_kept > 0 && (
                    <span className="text-body-sm text-muted-foreground">
                      {item.next_due
                        ? translate('employeeRetentionKeptUntil', {
                            count: item.documents_kept,
                            date: formatDate(item.next_due),
                          })
                        : translate('employeeRetentionKept', { count: item.documents_kept })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-caption text-muted-foreground">
            {translate('employeeRetentionExport')}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

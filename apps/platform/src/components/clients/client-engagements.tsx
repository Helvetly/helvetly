'use client'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { ProgressBar } from '@/components/engagements/engagement-bits'
import { EngagementForm } from '@/components/engagements/engagement-form'
import { RecordLink } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import { listEngagements, periodLabel } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { queryKeys } from '@/lib/queries'

/** The client's scheduled and active engagements (the list's default status), with a "New engagement" start. */
export function ClientEngagements({ clientId }: { clientId: string }) {
  const [creating, setCreating] = useState(false)
  const list = useQuery({
    queryKey: [...queryKeys.engagements, 'client', clientId],
    queryFn: () => listEngagements({ client_id: clientId, page_size: 50 }),
  })
  const rows = list.data?.data ?? []

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-medium">{translate('engagements')}</h2>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          {translate('newEngagement')}
        </Button>
      </div>
      {list.error ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          {errorMessage(list.error)}
        </p>
      ) : !list.data ? (
        <Loader className="min-h-32" />
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-card px-6 py-12 text-center text-[13px] text-muted-foreground shadow-elevation-1">
          {translate('noRunningEngagementsForThisClient')}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl bg-card shadow-elevation-1">
          {rows.map((e) => (
            <li key={e.id}>
              <RecordLink
                href={`/engagements?id=${encodeURIComponent(e.id)}`}
                className="grid w-full gap-1.5 px-4 py-3 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40"
              >
                <span className="text-[14px]">{e.title}</span>
                {e.current_period && (
                  <>
                    <span className="text-[12.5px] text-muted-foreground">
                      {periodLabel(e.current_period)}
                    </span>
                    <ProgressBar period={e.current_period} unit={e.unit} nested />
                  </>
                )}
              </RecordLink>
            </li>
          ))}
        </ul>
      )}
      <EngagementForm open={creating} onOpenChange={setCreating} clientId={clientId} />
    </div>
  )
}

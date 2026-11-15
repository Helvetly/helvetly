'use client'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Ban, CalendarClock, Eye, PencilLine, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'
import { scopeSummary, TOKEN_RESOURCES, type ScopeMatrix } from '@/lib/token-scopes'

const ROLE: Record<string, string> = {
  owner: translate('owner'),
  admin: translate('admin'),
  member: translate('member'),
}

/**
 * Custom access: one row per resource with Read and Write checkboxes. Write implies read, so ticking
 * Write ticks Read and unticking Read unticks Write. A resource no operation changes has no Write.
 */
export function ScopeMatrixField({
  value,
  error,
  onChange,
}: {
  value: ScopeMatrix
  error?: string
  onChange: (next: ScopeMatrix) => void
}) {
  const errorId = 'token-scopes-error'
  return (
    <fieldset aria-describedby={error ? errorId : undefined} className="-mt-2 grid gap-1.5">
      <legend className="sr-only">{translate('customAccess')}</legend>
      <div className={cn('overflow-hidden rounded-lg border', error && 'border-destructive/60')}>
        <table aria-label={translate('customAccess')} className="w-full text-body-sm">
          <thead className="bg-muted/50 text-caption text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                {translate('resource')}
              </th>
              <th scope="col" className="w-18 py-1.5 font-medium">
                {translate('read4')}
              </th>
              <th scope="col" className="w-18 py-1.5 font-medium">
                {translate('write3')}
              </th>
            </tr>
          </thead>
          <tbody>
            {TOKEN_RESOURCES.map(({ name, label, writable }) => {
              const access = value[name]
              return (
                <tr key={name} className="h-9 border-t">
                  <th scope="row" className="px-3 text-left font-normal">
                    {label}
                  </th>
                  <td className="text-center align-middle">
                    <Checkbox
                      aria-label={translate('read3', { label: label })}
                      className="mx-auto"
                      checked={access !== 'none'}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...value,
                          [name]: checked === true ? 'read' : 'none',
                        })
                      }
                    />
                  </td>
                  <td className="text-center align-middle">
                    {writable ? (
                      <Checkbox
                        aria-label={translate('write2', { label: label })}
                        className="mx-auto"
                        checked={access === 'write'}
                        onCheckedChange={(checked) =>
                          onChange({
                            ...value,
                            [name]: checked === true ? 'write' : 'read',
                          })
                        }
                      />
                    ) : (
                      <span className="text-muted-foreground/60">
                        <span aria-hidden>—</span>
                        <span className="sr-only">{translate('readOnlyThroughTheAPI')}</span>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-muted-foreground">
        {translate('writeTicksReadTooADashTheAPICan')}
      </p>
      {error && (
        <p id={errorId} className="text-body-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function Line({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 stroke-[1.75] text-muted-foreground" />
      <span className="min-w-0 text-pretty">{children}</span>
    </li>
  )
}

const list = (labels: string[]) => labels.join(', ')

/** What the token will be able to do, in plain words, before it is created. */
export function TokenSummary({
  scopes,
  expiresInDays,
}: {
  scopes: string[]
  expiresInDays: number | null
}) {
  const session = useSession().data
  const [openedAt] = useState(Date.now)
  const summary = scopeSummary(scopes)
  const until =
    expiresInDays === null
      ? translate('neverExpiresRevokeItHereWhenYouNoLonger')
      : translate('worksUntil', {
          value1: formatDate(new Date(openedAt + expiresInDays * 86_400_000).toISOString()),
        })
  return (
    <section
      aria-label={translate('whatThisTokenCanDo')}
      className="grid gap-2.5 rounded-lg bg-muted/50 px-4 py-3.5 text-body-sm"
    >
      <h3 className="text-body-sm font-medium">{translate('whatThisTokenCanDo')}</h3>
      <ul className="grid gap-2 text-muted-foreground">
        <Line icon={Eye}>
          {summary.readsAll ? (
            <>
              <span className="text-foreground">{translate('readEverything')}</span>
              {translate('theAPIOffers')}
            </>
          ) : summary.reads.length > 0 ? (
            <>
              {translate('read')}
              <span className="text-foreground">{list(summary.reads)}</span>.
            </>
          ) : (
            translate('readNothingYetChooseAtLeastOneResource')
          )}
        </Line>
        <Line icon={PencilLine}>
          {summary.writesAll ? (
            <>
              <span className="text-foreground">{translate('createEditAndIssue')}</span>
              {translate('anythingTheAPIOffers')}
            </>
          ) : summary.writes.length > 0 ? (
            <>
              {translate('createAndEdit')}
              <span className="text-foreground">{list(summary.writes)}</span>.
            </>
          ) : (
            translate('changeNothing')
          )}
        </Line>
        <Line icon={ShieldCheck}>
          {translate('actsAsYou')}
          {session && (
            <>
              {' '}
              {translate('in')}
              <span className="text-foreground">{session.workspace.name}</span>
              {translate('neverBeyondYourRole')}
              {ROLE[session.role] ?? session.role})
            </>
          )}
          .
        </Line>
        <Line icon={Ban}>{translate('canNeverManageMembersBillingAPITokensOrYour')}</Line>
        <Line icon={CalendarClock}>{until}</Line>
      </ul>
    </section>
  )
}

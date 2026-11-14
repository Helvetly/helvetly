'use client'

import { Checkbox } from '@helvetly/ui/components/checkbox'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Ban, CalendarClock, Eye, PencilLine, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useSession } from '@/lib/queries'
import { scopeSummary, TOKEN_RESOURCES, type ScopeMatrix } from '@/lib/token-scopes'

const ROLE: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

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
      <legend className="sr-only">Custom access</legend>
      <div className={cn('overflow-hidden rounded-lg border', error && 'border-destructive/60')}>
        <table aria-label="Custom access" className="w-full text-body-sm">
          <thead className="bg-muted/50 text-caption text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                Resource
              </th>
              <th scope="col" className="w-18 py-1.5 font-medium">
                Read
              </th>
              <th scope="col" className="w-18 py-1.5 font-medium">
                Write
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
                      aria-label={`Read ${label}`}
                      className="mx-auto"
                      checked={access !== 'none'}
                      onCheckedChange={(checked) =>
                        onChange({ ...value, [name]: checked === true ? 'read' : 'none' })
                      }
                    />
                  </td>
                  <td className="text-center align-middle">
                    {writable ? (
                      <Checkbox
                        aria-label={`Write ${label}`}
                        className="mx-auto"
                        checked={access === 'write'}
                        onCheckedChange={(checked) =>
                          onChange({ ...value, [name]: checked === true ? 'write' : 'read' })
                        }
                      />
                    ) : (
                      <span className="text-muted-foreground/60">
                        <span aria-hidden>—</span>
                        <span className="sr-only">Read only through the API</span>
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
        Write ticks Read too. A dash: the API can only read it for now.
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
      ? 'Never expires. Revoke it here when you no longer need it.'
      : `Works until ${formatDate(new Date(openedAt + expiresInDays * 86_400_000).toISOString())}.`
  return (
    <section
      aria-label="What this token can do"
      className="grid gap-2.5 rounded-lg bg-muted/50 px-4 py-3.5 text-body-sm"
    >
      <h3 className="text-body-sm font-medium">What this token can do</h3>
      <ul className="grid gap-2 text-muted-foreground">
        <Line icon={Eye}>
          {summary.readsAll ? (
            <>
              <span className="text-foreground">Read everything</span> the API offers.
            </>
          ) : summary.reads.length > 0 ? (
            <>
              Read <span className="text-foreground">{list(summary.reads)}</span>.
            </>
          ) : (
            'Read nothing yet: choose at least one resource.'
          )}
        </Line>
        <Line icon={PencilLine}>
          {summary.writesAll ? (
            <>
              <span className="text-foreground">Create, edit and issue</span> anything the API
              offers.
            </>
          ) : summary.writes.length > 0 ? (
            <>
              Create and edit <span className="text-foreground">{list(summary.writes)}</span>.
            </>
          ) : (
            'Change nothing.'
          )}
        </Line>
        <Line icon={ShieldCheck}>
          Acts as you
          {session && (
            <>
              {' '}
              in <span className="text-foreground">{session.workspace.name}</span>, never beyond
              your role ({ROLE[session.role] ?? session.role})
            </>
          )}
          .
        </Line>
        <Line icon={Ban}>Can never manage members, billing, API tokens or your account.</Line>
        <Line icon={CalendarClock}>{until}</Line>
      </ul>
    </section>
  )
}

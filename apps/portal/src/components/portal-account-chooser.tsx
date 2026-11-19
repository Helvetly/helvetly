'use client'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { errorMessage } from '@helvetly/ui/lib/http'
import { useMutation } from '@tanstack/react-query'
import { ChevronRight, LoaderCircle } from 'lucide-react'

import { translate } from '@/lib/i18n'
import { choosePortalAccount, type PortalAccount } from '@/lib/portal'
import { shorten } from '@/lib/text'

import { WorkspaceMark } from './portal-bits'

// The header's cut: the supplier's name after 16 characters, the whole of it in a tooltip.
const NAME_CHARS = 16

const leave = (url: string) => window.location.assign(url)

/**
 * The first screen after the code on the shared portal for an address with several clients: one row per account,
 * each opening its supplier's own portal address. `go` leaves for that address (a test's spy in stories).
 */
export function PortalAccountChooser({
  email,
  accounts,
  go = leave,
}: {
  email: string
  accounts: PortalAccount[]
  go?: (url: string) => void
}) {
  const choose = useMutation({ mutationFn: choosePortalAccount, onSuccess: (url) => go(url) })
  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5 text-center">
        <h1 className="text-page font-semibold tracking-tight">{translate('chooseAnAccount')}</h1>
        <p className="text-body text-balance text-muted-foreground">
          {translate('emailIsAClientOfSeveralSuppliers', { email })}
        </p>
      </div>
      <ul className="grid gap-2">
        {accounts.map((account) => {
          const short = shorten(account.workspace_name, NAME_CHARS)
          const opening = choose.isPending && choose.variables === account.client_id
          // A cut name is read whole: the visible cut is hidden from screen readers, the whole name is not.
          const name = (
            <span className="truncate text-body font-semibold">
              {short === account.workspace_name ? (
                short
              ) : (
                <>
                  <span aria-hidden>{short}</span>
                  <span className="sr-only">{account.workspace_name}</span>
                </>
              )}
            </span>
          )
          return (
            <li key={account.client_id}>
              <button
                type="button"
                disabled={choose.isPending || choose.isSuccess}
                onClick={() => choose.mutate(account.client_id)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-card"
              >
                <WorkspaceMark
                  name={account.workspace_name}
                  logoUrl={account.logo_url ?? undefined}
                />
                <span className="grid min-w-0 flex-1 leading-tight">
                  {short === account.workspace_name ? (
                    name
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>{name}</TooltipTrigger>
                      <TooltipContent>{account.workspace_name}</TooltipContent>
                    </Tooltip>
                  )}
                  <span className="truncate text-body-sm text-muted-foreground">
                    {translate('asClient', { client: account.client_name })}
                  </span>
                </span>
                {opening ? (
                  <LoaderCircle
                    aria-hidden
                    className="size-4 shrink-0 animate-spin text-brand-solid motion-reduce:animate-none"
                  />
                ) : (
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {choose.isError && <InlineError>{errorMessage(choose.error)}</InlineError>}
    </div>
  )
}

'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { BadgeCheck, Building2, CircleAlert, Loader2 } from 'lucide-react'
import { useRef, useState, type ComponentProps, type FocusEvent, type KeyboardEvent } from 'react'

import type { Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { useRegisterCompany, useRegisterSearch, type RegisterCompany } from '@/lib/uid-register'

import { registerCheck, uidToCheck } from './uid-register-model'

/**
 * The company name input; for a Swiss company it suggests matches from the UID register as one types
 * (a name or a CHE number). The list floats over the form, so nothing below moves. Arrow down moves
 * into the list, Escape returns to the field.
 */
export function RegisterNameInput({
  lookup,
  onPick,
  className,
  ...input
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  /** Whether to ask the register (a Swiss company). */
  lookup: boolean
  onPick: (company: RegisterCompany) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const search = useRegisterSearch(input.value, lookup && open)
  const companies = search.data ?? []
  const showing = lookup && open && input.value.trim().length >= 2
  const status = search.isError
    ? translate('uidRegisterUnavailable')
    : search.isFetching && !search.data
      ? translate('uidSearchLoading')
      : search.isSuccess && companies.length === 0
        ? translate('uidSearchNotFound')
        : null
  const listed = showing && companies.length > 0

  const choices = () => [...(root.current?.querySelectorAll('button') ?? [])]
  const close = () => {
    setOpen(false)
    field.current?.focus()
  }
  const pick = (company: RegisterCompany) => {
    close()
    onPick(company)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!showing) return
    const list = choices()
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!list.length) return
      event.preventDefault()
      const next = at + (event.key === 'ArrowDown' ? 1 : -1)
      if (next < 0) field.current?.focus()
      else list[Math.min(next, list.length - 1)]?.focus()
    } else if (event.key === 'Escape') {
      // Closes the list, not the drawer.
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  // Leaving the field and its list closes the list; moving between them doesn't.
  const onBlur = (event: FocusEvent) => {
    if (!root.current?.contains(event.relatedTarget)) setOpen(false)
  }

  return (
    <div ref={root} className="relative" data-suggesting={showing || undefined}>
      <input
        {...input}
        ref={field}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onChange={(event) => {
          input.onChange(event.target.value)
          setOpen(true)
        }}
        className={className}
      />
      {showing && (listed || status) && (
        <div className="absolute top-full left-0 z-30 mt-1 w-[max(100%,24rem)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-popover p-1 text-sm text-popover-foreground shadow-elevation-2">
          {listed && (
            <ul aria-label={translate('uidRegisterMatches')}>
              {companies.map((company) => (
                <li key={company.uid}>
                  <button
                    type="button"
                    // Keeps the focus where it is, so the field's blur doesn't close the list first.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(company)}
                    onKeyDown={onKeyDown}
                    onBlur={onBlur}
                    className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted"
                  >
                    <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate">{company.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[company.uid, [company.zip, company.city].filter(Boolean).join(' ')]
                          .filter(Boolean)
                          .join(' · ')}
                        {company.vat && ` · ${translate('vatRegistered')}`}
                        {!company.active && ` · ${translate('uidInactive')}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status && (
            <output className="block px-2 py-1.5 text-xs text-muted-foreground">{status}</output>
          )}
          <p className="px-2 pt-1 pb-0.5 text-caption text-muted-foreground">
            {translate('fromTheSwissUIDRegister')}
          </p>
        </div>
      )}
    </div>
  )
}

/** Under the VAT / UID field: what the register says about the Swiss UID typed there, if any. */
export function RegisterCheckHint({ vat }: { vat: string }) {
  const uid = uidToCheck(vat)
  const answer = useRegisterCompany(uid)
  if (!uid) return null
  const check = registerCheck(vat, {
    loading: answer.isPending,
    failed: answer.isError,
    company: answer.data,
  })
  const Icon = answer.isPending ? Loader2 : check.tone === 'ok' ? BadgeCheck : CircleAlert
  return (
    <output
      className={cn(
        'inline-flex items-center gap-1',
        check.tone === 'ok' && 'text-success',
        check.tone === 'warn' && 'text-warning',
      )}
    >
      <Icon className={cn('size-3.5 shrink-0', answer.isPending && 'animate-spin')} />
      {check.text}
    </output>
  )
}

/** Beside a client's name: the UID register knows it as an active company. */
export function UidVerifiedBadge({
  client,
}: {
  client: Pick<Client, 'verified_uid' | 'uid_verified_at'>
}) {
  if (!client.verified_uid || !client.uid_verified_at) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-default rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Badge tone="green">
            <BadgeCheck className="mr-1 size-3.5" />
            {translate('uidVerified')}
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {translate('uidVerifiedTip', {
          uid: client.verified_uid,
          date: formatDate(client.uid_verified_at),
        })}
      </TooltipContent>
    </Tooltip>
  )
}

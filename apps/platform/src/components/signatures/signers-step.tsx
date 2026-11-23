'use client'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import {
  Command,
  CommandFieldInput,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@helvetly/ui/components/command'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { InputGroup, InputGroupAddon } from '@helvetly/ui/components/input-group'
import { Popover, PopoverAnchor, PopoverContent } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, GripVertical, Pencil, UserPlus, X } from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'

import { initialsOf } from '@/components/initials'
import { OptionSegments } from '@/components/option-segments'
import { StepTitle } from '@/components/wizard-sheet'
import { useClientSearch, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { useMembers } from '@/lib/members'
import { hostColor, hostTint } from '@/lib/scheduling'
import { checkSigners, EMAIL, type DraftSigner, type SigningOrder } from '@/lib/signatures'
import { primaryContact } from '@/lib/templates'

/** At most this many people sign one request. */
const MAX_SIGNERS = 10
const EXPIRY_PRESETS = [7, 14, 30, 60, 90] as const

/** A signer row in the wizard: `id` keeps its identity through edits and moves; `tag` says where it came from. */
export type SignerRow = DraftSigner & { id: string; tag?: string }
export const signerRow = (
  signer: DraftSigner = { name: '', email: '' },
  tag?: string,
): SignerRow => ({
  ...signer,
  id: crypto.randomUUID(),
  ...(tag && { tag }),
})

/** The tag of a person taken from a client. */
export const clientTag = (client: Pick<Client, 'name'>) =>
  translate('signerTagClient', { name: client.name })

/** A client's main contact (or the client's own address) as a signer, or null without an email. */
export function clientSigner(client: Client): SignerRow | null {
  const contact = primaryContact(client)
  const person = contact?.email
    ? { name: contact.name, email: contact.email }
    : client.email
      ? { name: client.name, email: client.email }
      : null
  return person && signerRow(person, clientTag(client))
}

/** The day links stop working, sent today. */
export const expiryDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

/** Which signers moved: a removal, or adjacent swaps in order (a drag is several). */
export type SignerChange = { removed?: number; swaps?: [number, number][] }

/** Moves one signer from `from` to `to` by adjacent swaps, so the fields can follow each swap. */
export function moveSigner<T>(list: T[], from: number, to: number) {
  const next = [...list]
  const swaps: [number, number][] = []
  for (let at = from; at !== to; at += to > from ? 1 : -1) {
    const other = at + (to > from ? 1 : -1)
    const a = next[at]
    const b = next[other]
    if (a === undefined || b === undefined) break
    next[at] = b
    next[other] = a
    swaps.push([at, other])
  }
  return { list: next, swaps }
}

/** Who signs: the list, one search to add people, the order and when links stop working. */
export function SignersStep({
  signers,
  onSigners,
  order,
  onOrder,
  days,
  onDays,
  tried,
  fixed = false,
}: {
  signers: SignerRow[]
  onSigners: (signers: SignerRow[], change?: SignerChange) => void
  order: SigningOrder
  onOrder: (order: SigningOrder) => void
  days: number
  onDays: (days: number) => void
  tried: boolean
  /** A template's roles: one signer each, in the template's order; people are edited, not added. */
  fixed?: boolean
}) {
  const check = checkSigners(signers)
  const [editing, setEditing] = useState<string | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  const sequential = order === 'sequential' && !fixed && signers.length > 1
  const set = (index: number, change: Partial<DraftSigner>) =>
    onSigners(signers.map((signer, i) => (i === index ? { ...signer, ...change } : signer)))
  const move = (from: number, to: number) => {
    if (to < 0 || to >= signers.length || from === to) return
    const moved = moveSigner(signers, from, to)
    onSigners(moved.list, { swaps: moved.swaps })
  }
  // In one-after-another order a row is dragged by its handle and dropped on another row.
  const dragRow = (index: number) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = 'move'
      setDragged(index)
    },
    onDragOver: (event: DragEvent) => {
      if (dragged !== null) event.preventDefault()
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      if (dragged !== null) move(dragged, index)
      setDragged(null)
    },
    onDragEnd: () => setDragged(null),
  })
  const taken = new Set(signers.map((signer) => signer.email.trim().toLowerCase()))
  const add = (person: DraftSigner, tag?: string) => {
    const row = signerRow(person, tag)
    onSigners([...signers, row])
    // Typed as an address only: its name is asked for at once.
    if (!person.name.trim()) setEditing(row.id)
  }

  return (
    <>
      <StepTitle
        title={translate('whoSigns')}
        text={translate('eachSignerGetsTheirOwnLinkByEmailNobody')}
      />
      <section aria-label={translate('signers')} className="grid gap-2">
        {signers.length > 0 && (
          <ol className="grid gap-1.5">
            {signers.map((signer, index) => {
              const row = check.rows[index]
              const invalid = tried && !!(row?.name || row?.email)
              const open =
                editing === signer.id || invalid || (!signer.name.trim() && !signer.email.trim())
              return (
                <li
                  key={signer.id}
                  {...(sequential && dragRow(index))}
                  className={cn(
                    'grid gap-2 rounded-xl border bg-card px-2.5 py-2 transition-colors',
                    dragged === index && 'opacity-60',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {sequential && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={translate('signerReorder', {
                              name: signer.name || signer.email,
                            })}
                            onKeyDown={(event) => {
                              const to = { ArrowUp: index - 1, ArrowDown: index + 1 }[event.key]
                              if (to === undefined) return
                              event.preventDefault()
                              move(index, to)
                            }}
                            className="-mx-1 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
                          >
                            <GripVertical className="size-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{translate('signerReorderTip')}</TooltipContent>
                      </Tooltip>
                    )}
                    {sequential && (
                      <span className="w-4 shrink-0 text-center text-caption text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                    )}
                    <span
                      aria-hidden
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-micro font-semibold tracking-wide"
                      style={{
                        backgroundColor: hostTint(signer.email || signer.id, 18),
                        // Darkened towards the text colour, so the initials keep their contrast.
                        color: `color-mix(in oklab, ${hostColor(signer.email || signer.id)} 45%, var(--color-foreground))`,
                      }}
                    >
                      {initialsOf(signer.name || signer.email) || '?'}
                    </span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-body-sm font-medium">
                        {signer.name.trim() || translate('signer', { value1: index + 1 })}
                      </span>
                      <span className="truncate text-caption text-muted-foreground">
                        {signer.email.trim() || '—'}
                      </span>
                    </span>
                    {signer.tag && (
                      <span
                        title={signer.tag}
                        className="max-w-32 shrink-0 truncate rounded-full bg-muted px-2 py-px text-caption text-muted-foreground"
                      >
                        {signer.tag}
                      </span>
                    )}
                    <IconAction
                      label={translate('signerEdit', {
                        name: signer.name || translate('signer', { value1: index + 1 }),
                      })}
                      onClick={() => setEditing(editing === signer.id ? null : signer.id)}
                    >
                      <Pencil />
                    </IconAction>
                    {!fixed && (
                      <IconAction
                        label={translate('removeSigner', { value1: index + 1 })}
                        onClick={() => {
                          onSigners(
                            signers.filter((_, i) => i !== index),
                            { removed: index },
                          )
                        }}
                      >
                        <X />
                      </IconAction>
                    )}
                  </div>
                  {open && (
                    <SignerEdit
                      index={index}
                      signer={signer}
                      errors={tried ? row : undefined}
                      duplicate={
                        signers.findIndex(
                          (other) =>
                            other.email.trim().toLowerCase() === signer.email.trim().toLowerCase(),
                        ) !== index && !!signer.email.trim()
                      }
                      onChange={(change) => set(index, change)}
                      onDone={() => setEditing(null)}
                    />
                  )}
                </li>
              )
            })}
          </ol>
        )}
        {!fixed && (
          <SignerSearch taken={taken} disabled={signers.length >= MAX_SIGNERS} onAdd={add} />
        )}
        {tried && check.list && (
          <p role="alert" className="text-caption text-destructive">
            {check.list}
          </p>
        )}
      </section>

      {(signers.length > 1 || fixed) && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-body-sm font-medium">{translate('signingOrder')}</legend>
          <OptionSegments
            label={translate('signingOrder')}
            value={order}
            onChange={onOrder}
            options={[
              {
                value: 'parallel',
                label: translate('everyoneAtOnce'),
                text: translate('allSignersGetTheirLinkNow'),
              },
              {
                value: 'sequential',
                label: translate('oneAfterAnother'),
                text: translate('eachGetsTheirLinkWhenTheOneBeforeHasSigned'),
              },
            ]}
          />
        </fieldset>
      )}

      <ExpiryField days={days} onDays={onDays} />
    </>
  )
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className="shrink-0 cursor-pointer text-muted-foreground"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** A signer's name and address, edited in place. */
function SignerEdit({
  index,
  signer,
  errors,
  duplicate,
  onChange,
  onDone,
}: {
  index: number
  signer: SignerRow
  errors?: { name?: string; email?: string }
  duplicate: boolean
  onChange: (change: Partial<DraftSigner>) => void
  onDone: () => void
}) {
  const focused = useRef(false)
  const emailError =
    errors?.email ?? (duplicate ? translate('signerDuplicate', { email: signer.email }) : undefined)
  const done = (event: { key: string }) => {
    if (event.key === 'Enter') onDone()
  }
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <div className="grid gap-1">
        <Input
          aria-label={translate('signerName', { value1: index + 1 })}
          placeholder={translate('fullName')}
          value={signer.name}
          maxLength={200}
          ref={(element) => {
            // Opened to name a person just added by address: focus the name, once.
            if (element && !focused.current && !signer.name) {
              focused.current = true
              element.focus()
            }
          }}
          aria-invalid={!!errors?.name}
          onChange={(event) => onChange({ name: event.target.value })}
          onKeyDown={done}
        />
        {errors?.name && <p className="text-caption text-destructive">{errors.name}</p>}
      </div>
      <div className="grid gap-1">
        <Input
          type="email"
          aria-label={translate('signerEmail', { value1: index + 1 })}
          placeholder={translate('nameCompanyCh')}
          value={signer.email}
          aria-invalid={!!emailError}
          onChange={(event) => onChange({ email: event.target.value })}
          onKeyDown={done}
        />
        {emailError && <p className="text-caption text-destructive">{emailError}</p>}
      </div>
      <Button variant="outline" className="cursor-pointer gap-1.5" onClick={onDone}>
        <Check className="size-4" />
        {translate('done')}
      </Button>
    </div>
  )
}

type Suggestion = { key: string; name: string; email: string; detail: string; tag?: string }

/** One field to add a signer: clients' contacts and the team as suggestions, or a new address as typed. */
function SignerSearch({
  taken,
  disabled,
  onAdd,
}: {
  /** Signers' addresses, lower case: never suggested again, and refused when typed. */
  taken: ReadonlySet<string>
  disabled: boolean
  onAdd: (person: DraftSigner, tag?: string) => void
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const clients = useClientSearch(term, open)
  const members = useMembers()
  const query = term.trim().toLowerCase()
  const free = (email: string) => !!email && !taken.has(email.toLowerCase())
  const matches = (text: string) => !query || text.toLowerCase().includes(query)

  const contacts: Suggestion[] = (clients.data?.data ?? []).flatMap((client) => {
    const list: Suggestion[] = client.contacts
      .filter((contact) => contact.email)
      .map((contact) => ({
        key: `contact:${contact.id}`,
        name: contact.name,
        email: contact.email ?? '',
        detail: [contact.role, client.name].filter(Boolean).join(' · '),
        tag: clientTag(client),
      }))
    if (client.email && !client.contacts.some((contact) => contact.email === client.email))
      list.push({
        key: `client:${client.id}`,
        name: client.name,
        email: client.email,
        detail: translate('client6', { number: client.number }),
        tag: clientTag(client),
      })
    // The search finds clients; only their people who match what is typed are offered.
    return list.filter(
      (person) => free(person.email) && matches(`${person.name} ${person.email} ${person.detail}`),
    )
  })
  const team: Suggestion[] = (members.data ?? [])
    .filter((member) => free(member.email) && matches(`${member.name} ${member.email}`))
    .map((member) => ({
      key: `member:${member.user_id}`,
      name: member.name,
      email: member.email,
      detail: member.is_you ? translate('signerMe') : translate('signerTagTeam'),
      tag: translate('signerTagTeam'),
    }))
  const known = [...contacts, ...team]
  const typed: Suggestion | null =
    EMAIL.test(query) &&
    free(query) &&
    !known.some((person) => person.email.toLowerCase() === query)
      ? {
          key: 'typed',
          name: '',
          email: term.trim(),
          detail: '',
        }
      : null
  const groups = [
    { label: null, items: typed ? [typed] : [] },
    { label: translate('signerGroupContacts'), items: contacts },
    { label: translate('signerGroupTeam'), items: team },
  ].filter((group) => group.items.length > 0)
  const listed = groups.length > 0
  const duplicate = EMAIL.test(query) && taken.has(query)

  const pick = (person: Suggestion) => {
    onAdd({ name: person.name, email: person.email }, person.tag)
    setTerm('')
  }

  return (
    <div className="grid gap-1">
      {/* The house autocomplete: cmdk moves through the list with the arrows, Enter adds the active one. */}
      <Command
        label={translate('addSigner').trim()}
        shouldFilter={false}
        className="overflow-visible rounded-none! bg-transparent p-0"
      >
        <Popover open={open && listed} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <InputGroup>
              <InputGroupAddon>
                <UserPlus />
              </InputGroupAddon>
              <CommandFieldInput
                listOpen={open && listed}
                aria-invalid={duplicate || undefined}
                autoComplete="off"
                disabled={disabled}
                placeholder={translate('signerSearchPlaceholder')}
                value={term}
                onValueChange={(value) => {
                  setTerm(value)
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setOpen(false)
                }}
              />
            </InputGroup>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) min-w-72 p-0"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              // The field is outside the list: clicking back into it keeps the list open.
              if (event.target instanceof Element && event.target.closest('[cmdk-input]'))
                event.preventDefault()
            }}
          >
            <CommandList>
              {groups.map((group) => (
                <CommandGroup key={group.label ?? 'typed'} heading={group.label ?? undefined}>
                  {group.items.map((person) => (
                    <CommandItem
                      key={person.key}
                      value={person.key}
                      onSelect={() => pick(person)}
                      className="grid gap-0"
                    >
                      {person.key === 'typed' ? (
                        <span className="truncate text-body-sm">
                          {translate('signerAddEmail', { email: person.email })}
                        </span>
                      ) : (
                        <>
                          <span className="truncate text-body-sm">{person.name}</span>
                          <span className="truncate text-caption text-muted-foreground">
                            {[person.email, person.detail].filter(Boolean).join(' · ')}
                          </span>
                        </>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </PopoverContent>
        </Popover>
      </Command>
      {duplicate && (
        <p role="alert" className="text-caption text-destructive">
          {translate('signerDuplicate', { email: term.trim() })}
        </p>
      )}
    </div>
  )
}

/** When links stop working: common lengths, or any number of days. */
function ExpiryField({ days, onDays }: { days: number; onDays: (days: number) => void }) {
  const preset = (EXPIRY_PRESETS as readonly number[]).includes(days)
  const [custom, setCustom] = useState(!preset)
  return (
    <FormField
      id="sig-days"
      label={translate('expiresAfter')}
      tip={translate('linksStopWorkingOn', { value1: formatDate(expiryDate(days)) })}
    >
      <div className="flex items-center gap-2">
        <Combobox
          id="sig-days"
          label={translate('expiresAfter')}
          className="w-40"
          value={custom ? 'custom' : String(days)}
          placeholder={translate('expiresAfter')}
          options={[
            ...EXPIRY_PRESETS.map((value) => ({
              value: String(value),
              label: translate('expiryDays', { days: value }),
            })),
            { value: 'custom', label: translate('custom') },
          ]}
          onChange={(value) => {
            setCustom(value === 'custom')
            if (value !== 'custom') onDays(Number(value))
          }}
        />
        {custom && (
          <>
            <Input
              type="number"
              aria-label={translate('days')}
              min={1}
              max={365}
              value={days}
              className="w-20"
              onChange={(event) =>
                onDays(Math.min(365, Math.max(1, Math.round(Number(event.target.value) || 1))))
              }
            />
            <span className="text-sm text-muted-foreground">{translate('days')}</span>
          </>
        )}
      </div>
    </FormField>
  )
}

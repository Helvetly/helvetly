'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { PhoneInput } from '@helvetly/ui/components/phone-input'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import {
  displayPhone,
  PHONE_ERROR,
  phoneCountryOr,
  phoneDraft,
  toE164,
  type CountryCode,
} from '@helvetly/ui/lib/phone'
import { useQueryClient } from '@tanstack/react-query'
import { Ellipsis, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { Initials } from '@/components/initials'
import { ApiError, errorMessage } from '@/lib/api'
import { clientKeys, useContactMutations, type Client, type Contact } from '@/lib/clients'
import { translate } from '@/lib/i18n'

import { contactActions, sortContacts, withPrimary } from './contacts-model'
import { inputClass } from './fields'

type Draft = { name: string; role: string; email: string; phone: string; country: CountryCode }
type Errors = Partial<Record<keyof Draft, string>>

/** A new contact's phone country defaults to the client's. */
const toDraft = (contact: Contact | undefined, clientCountry: string | null): Draft => {
  const { phone, country } = phoneDraft(contact?.phone, clientCountry)
  return {
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    email: contact?.email ?? '',
    phone,
    country,
  }
}

function check(draft: Draft): Errors {
  const errors: Errors = {}
  if (!draft.name.trim()) errors.name = translate('enterAName')
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()))
    errors.email = translate('enterAValidEmailAddress')
  if (draft.phone.trim() && !toE164(draft.phone, draft.country)) errors.phone = PHONE_ERROR
  return errors
}

function ContactEditor({
  contact,
  clientCountry,
  pending,
  onSave,
  onCancel,
}: {
  contact?: Contact
  clientCountry: string | null
  pending: boolean
  onSave: (draft: Draft, setErrors: (errors: Errors) => void) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(() => toDraft(contact, clientCountry))
  const [errors, setErrors] = useState<Errors>({})
  const nameInput = useRef<HTMLInputElement>(null)
  // The editor opens on the name.
  useEffect(() => nameInput.current?.focus(), [])
  const field = (key: 'name' | 'role' | 'email', label: string, type = 'text') => (
    <label className="grid gap-1 text-[12.5px] font-medium">
      {label}
      <input
        type={type}
        value={draft[key]}
        aria-invalid={errors[key] ? true : undefined}
        ref={key === 'name' ? nameInput : undefined}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
        className={inputClass}
      />
      {errors[key] && <span className="font-normal text-destructive">{errors[key]}</span>}
    </label>
  )
  return (
    <form
      noValidate
      className="grid gap-3 rounded-xl bg-muted/50 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const found = check(draft)
        setErrors(found)
        if (!Object.keys(found).length) onSave(draft, setErrors)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field('name', translate('name'))}
        {field('role', translate('role'))}
        {field('email', translate('email'), 'email')}
        <div className="grid gap-1 text-[12.5px] font-medium">
          <label htmlFor="contact-phone">{translate('phone')}</label>
          <PhoneInput
            id="contact-phone"
            value={draft.phone}
            country={draft.country}
            invalid={Boolean(errors.phone)}
            onChange={(phone) => setDraft((current) => ({ ...current, phone }))}
            onCountryChange={(code) =>
              setDraft((current) => ({ ...current, country: phoneCountryOr(code) }))
            }
          />
          {errors.phone && <span className="font-normal text-destructive">{errors.phone}</span>}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {translate('cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {contact ? translate('save2') : translate('addContact2')}
        </Button>
      </div>
    </form>
  )
}

/** The people at a client: add, edit and delete inline, one of them primary. */
export function ClientContacts({ client }: { client: Client }) {
  const queryClient = useQueryClient()
  const { save, remove } = useContactMutations(client.id)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)
  const contacts = sortContacts(client.contacts)

  const submit =
    (contact: Contact | undefined) => (draft: Draft, setErrors: (errors: Errors) => void) =>
      save.mutate(
        {
          contactId: contact?.id,
          input: {
            name: draft.name.trim(),
            role: draft.role.trim() || null,
            email: draft.email.trim().toLowerCase() || null,
            phone: draft.phone.trim() ? toE164(draft.phone, draft.country) : null,
          },
        },
        {
          onSuccess: () => setEditing(null),
          onError: (error) => {
            const fields = error instanceof ApiError ? error.details.fields : null
            if (typeof fields === 'object' && fields !== null)
              setErrors(
                Object.fromEntries(
                  Object.entries(fields).map(([key, value]) => [key, String(value)]),
                ),
              )
            else toast.error(errorMessage(error))
          },
        },
      )

  const makePrimary = (contact: Contact) => {
    // Shown at once; the server's answer replaces it.
    queryClient.setQueryData<Client>(
      clientKeys.detail(client.id),
      (current) => current && { ...current, contacts: withPrimary(current.contacts, contact.id) },
    )
    save.mutate({ contactId: contact.id, input: { is_primary: true } }, { onError: toastError })
  }

  return (
    <div className="grid gap-2">
      {contacts.length === 0 && editing !== 'new' && (
        <p className="text-[13px] text-muted-foreground">
          {translate('noContactPersonsYet')}
          {client.is_company ? translate('addThePeopleYouDealWith') : '.'}
        </p>
      )}
      <ul className="grid gap-1">
        {contacts.map((contact) =>
          editing === contact.id ? (
            <li key={contact.id}>
              <ContactEditor
                contact={contact}
                clientCountry={client.country}
                pending={save.isPending}
                onSave={submit(contact)}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={contact.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Initials name={contact.name} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="flex items-center gap-2 truncate text-[13.5px]">
                  {contact.name}
                  {contact.is_primary && (
                    <StatusBadge tone="green">{translate('primary')}</StatusBadge>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {[contact.role, contact.email, contact.phone ? displayPhone(contact.phone) : null]
                    .filter(Boolean)
                    .join(' · ') || translate('noDetails')}
                </span>
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={translate('actionsFor', { name: contact.name })}
                    className="text-muted-foreground"
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  {contactActions(contact, contacts.length).map((action) =>
                    action === 'edit' ? (
                      <DropdownMenuItem key={action} onSelect={() => setEditing(contact.id)}>
                        {translate('edit')}
                      </DropdownMenuItem>
                    ) : action === 'primary' ? (
                      <DropdownMenuItem key={action} onSelect={() => makePrimary(contact)}>
                        {translate('makePrimary')}
                      </DropdownMenuItem>
                    ) : (
                      <span key={action} className="contents">
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleting(contact)}
                        >
                          <Trash2 />
                          {translate('delete')}
                        </DropdownMenuItem>
                      </span>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <ContactEditor
          clientCountry={client.country}
          pending={save.isPending}
          onSave={submit(undefined)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit text-muted-foreground"
          onClick={() => setEditing('new')}
        >
          <Plus />
          {translate('addContact')}
        </Button>
      )}
      {deleting && (
        <ConfirmDialog
          key={deleting.id}
          title={translate('remove3', { name: deleting.name })}
          body={
            deleting.is_primary && contacts.length > 1
              ? translate('theLongestStandingOtherContactBecomesPrimary')
              : translate('theContactIsRemovedFromThisClient')
          }
          confirmLabel={translate('removeContact')}
          tone="destructive"
          onDecide={(approved) => {
            const contact = deleting
            setDeleting(null)
            if (approved) remove.mutate(contact.id, { onError: toastError })
          }}
        />
      )}
    </div>
  )
}

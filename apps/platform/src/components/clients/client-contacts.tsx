'use client'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { PhoneInput } from '@helvetly/ui/components/phone-input'
import { Segmented } from '@helvetly/ui/components/segmented'
import {
  displayPhone,
  PHONE_ERROR,
  phoneCountryOr,
  phoneDraft,
  toE164,
  type CountryCode,
} from '@helvetly/ui/lib/phone'
import { useQueryClient } from '@tanstack/react-query'
import {
  Ellipsis,
  KeyRound,
  Pencil,
  Plus,
  Star,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { Initials } from '@/components/initials'
import { HelpTip } from '@/components/settings/help-tip'
import { ApiError, errorMessage } from '@/lib/api'
import {
  clientKeys,
  rolesOf,
  useSaveClient,
  useContactMutations,
  type Client,
  type Contact,
  type ContactInput,
  type DocumentsTo,
  type PersonRole,
} from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'

import {
  contactActions,
  nextRoles,
  sortContacts,
  withPrimary,
  type PersonAction,
} from './contacts-model'
import { inputClass } from './fields'

type Draft = {
  name: string
  role: string
  email: string
  phone: string
  country: CountryCode
  street: string
  street_number: string
  zip: string
  city: string
}
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
    street: contact?.street ?? '',
    street_number: contact?.street_number ?? '',
    zip: contact?.zip ?? '',
    city: contact?.city ?? '',
  }
}

/** A contact needs an email (invoices and letters go there); a participant may have none. */
function check(draft: Draft, roles: PersonRole[]): Errors {
  const errors: Errors = {}
  if (!draft.name.trim()) errors.name = translate('enterAName')
  if (!draft.email.trim()) {
    if (roles.includes('contact')) errors.email = translate('enterAnEmailAddress')
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()))
    errors.email = translate('enterAValidEmailAddress')
  if (draft.phone.trim() && !toE164(draft.phone, draft.country)) errors.phone = PHONE_ERROR
  return errors
}

function ContactEditor({
  contact,
  roles,
  clientCountry,
  pending,
  onSave,
  onCancel,
}: {
  contact?: Contact
  /** The person's roles: a participant also has a private address (for invoices addressed to them). */
  roles: PersonRole[]
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
  const required = (key: keyof Draft) =>
    key === 'name' || (key === 'email' && roles.includes('contact'))
  const field = (key: Exclude<keyof Draft, 'phone' | 'country'>, label: string, type = 'text') => (
    <label className="grid gap-1 text-[12.5px] font-medium">
      <span>
        {label}
        {required(key) && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </span>
      <input
        type={type}
        value={draft[key]}
        required={required(key)}
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
        const found = check(draft, roles)
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
        {roles.includes('participant') && (
          <>
            {field('street', translate('participantStreet'))}
            {field('street_number', translate('participantStreetNumber'))}
            {field('zip', translate('participantZip'))}
            {field('city', translate('participantCity'))}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {translate('cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {contact
            ? translate('save2')
            : roles.includes('contact')
              ? translate('addContact2')
              : translate('addParticipantSubmit')}
        </Button>
      </div>
    </form>
  )
}

/** Company | Participants: where a company's invoices and documents go; new drafts and sends only. */
export function DocumentsToSwitch({ client }: { client: Client }) {
  const saveClient = useSaveClient()
  const canWrite = useCan('write:clients')
  if (!client.is_company) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-body-sm text-muted-foreground">{translate('documentsGoTo')}</span>
      <Segmented<DocumentsTo>
        label={translate('documentsGoTo')}
        size="sm"
        value={client.documents_to ?? 'company'}
        options={[
          { value: 'company', label: translate('documentsToCompany') },
          { value: 'participants', label: translate('documentsToParticipants') },
        ]}
        onChange={(documents_to) => {
          if (!canWrite || saveClient.isPending) return
          saveClient.mutate({ id: client.id, input: { documents_to } }, { onError: toastError })
        }}
      />
      <HelpTip label={translate('documentsGoToHelpLabel')}>
        {translate('documentsGoToHelp')}
      </HelpTip>
    </div>
  )
}

/** Field errors onto the editor when there is one, else a toast. */
const fail = (setErrors?: (errors: Errors) => void) => (error: Error) => {
  const fields = error instanceof ApiError ? error.details.fields : null
  if (setErrors && typeof fields === 'object' && fields !== null)
    setErrors(
      Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)])),
    )
  else toast.error(errorMessage(error))
}
const actionIcon: Record<PersonAction, ReactNode> = {
  edit: <Pencil />,
  primary: <Star />,
  'add-contact': <UserPlus />,
  'remove-contact': <UserMinus />,
  'add-participant': <UserPlus />,
  'remove-participant': <UserMinus />,
  'portal-on': <KeyRound />,
  'portal-off': <KeyRound />,
  delete: <Trash2 />,
}

const actionLabel = (action: PersonAction) =>
  ({
    edit: translate('edit'),
    primary: translate('makePrimary'),
    'add-contact': translate('makeAContact'),
    'remove-contact': translate('noLongerAContact'),
    'add-participant': translate('makeAParticipant'),
    'remove-participant': translate('noLongerAParticipant'),
    'portal-on': translate('turnOnPortalAccess'),
    'portal-off': translate('turnOffPortalAccess'),
    delete: translate('delete'),
  })[action]

const actionGroup = (action: PersonAction) =>
  action === 'edit' ? 'edit' : action === 'delete' ? 'danger' : 'status'

/**
 * The people of a client in two groups: contacts (billing and correspondence, one of them primary) and, for a
 * company, participants (who take the service). A person can be in both; add, edit, change roles and delete inline.
 */
export function ClientContacts({ client }: { client: Client }) {
  const queryClient = useQueryClient()
  const { save, remove } = useContactMutations(client.id)
  const [editing, setEditing] = useState<{ id: string | 'new'; roles: PersonRole[] } | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)
  const people = sortContacts(client.contacts)
  const contacts = people.filter((person) => rolesOf(person).includes('contact'))
  const participants = people.filter((person) => rolesOf(person).includes('participant'))

  const submit =
    (contact: Contact | undefined, roles: PersonRole[]) =>
    (draft: Draft, setErrors: (errors: Errors) => void) => {
      const input: Partial<ContactInput> = {
        name: draft.name.trim(),
        role: draft.role.trim() || null,
        email: draft.email.trim().toLowerCase() || null,
        phone: draft.phone.trim() ? toE164(draft.phone, draft.country) : null,
      }
      if (!contact) input.roles = roles
      if (roles.includes('participant')) {
        input.street = draft.street.trim() || null
        input.street_number = draft.street_number.trim() || null
        input.zip = draft.zip.trim() || null
        input.city = draft.city.trim() || null
        input.country = input.street ? (contact?.country ?? client.country) : null
      }
      save.mutate(
        { contactId: contact?.id, input },
        { onSuccess: () => setEditing(null), onError: fail(setErrors) },
      )
    }

  const act = (contact: Contact, action: PersonAction) => {
    if (action === 'edit') return setEditing({ id: contact.id, roles: rolesOf(contact) })
    if (action === 'delete') return setDeleting(contact)
    if (action === 'primary') {
      // Shown at once; the server's answer replaces it.
      queryClient.setQueryData<Client>(
        clientKeys.detail(client.id),
        (current) => current && { ...current, contacts: withPrimary(current.contacts, contact.id) },
      )
      return save.mutate(
        { contactId: contact.id, input: { is_primary: true } },
        { onError: toastError },
      )
    }
    const input: Partial<ContactInput> =
      action === 'portal-on' || action === 'portal-off'
        ? { portal_enabled: action === 'portal-on' }
        : {
            roles: nextRoles(contact, action),
            ...(action === 'remove-participant' ? { portal_enabled: false } : {}),
          }
    save.mutate(
      { contactId: contact.id, input },
      {
        onSuccess: () => {
          if (action === 'portal-on')
            toast.success(translate('portalAccessOnFor', { name: contact.name }))
        },
        onError: fail(),
      },
    )
  }

  const row = (contact: Contact) =>
    editing?.id === contact.id ? (
      <li key={contact.id}>
        <ContactEditor
          contact={contact}
          roles={editing.roles}
          clientCountry={client.country}
          pending={save.isPending}
          onSave={submit(contact, editing.roles)}
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
              <Badge tone="green" size="sm">
                {translate('primary')}
              </Badge>
            )}
            {rolesOf(contact).includes('participant') && contact.portal_enabled && (
              <Badge tone="blue" size="sm">
                <UserCheck />
                {translate('portalAccess')}
              </Badge>
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
          <ActionMenuContent
            kind="dropdown"
            menu={{
              header: contact.name,
              actions: contactActions(contact, contacts.length, client.is_company).map(
                (action) => ({
                  id: action,
                  group: actionGroup(action),
                  icon: actionIcon[action],
                  label: actionLabel(action),
                  onSelect: () => act(contact, action),
                }),
              ),
            }}
          />
        </DropdownMenu>
      </li>
    )

  const group = (role: PersonRole, list: Contact[], empty: string, add: string) => (
    <section
      className="grid gap-2"
      aria-label={role === 'contact' ? translate('contacts') : translate('participants')}
    >
      {client.is_company && (
        <h3 className="text-caption font-medium text-muted-foreground">
          {role === 'contact' ? translate('contacts') : translate('participants')}
        </h3>
      )}
      {list.length === 0 && !(editing?.id === 'new' && editing.roles.includes(role)) && (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      )}
      <ul className="grid gap-1">{list.map(row)}</ul>
      {editing?.id === 'new' && editing.roles[0] === role ? (
        <ContactEditor
          roles={editing.roles}
          clientCountry={client.country}
          pending={save.isPending}
          onSave={submit(undefined, editing.roles)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit text-muted-foreground"
          onClick={() => setEditing({ id: 'new', roles: [role] })}
        >
          <Plus />
          {add}
        </Button>
      )}
    </section>
  )

  return (
    <div className="grid gap-5">
      {group(
        'contact',
        contacts,
        translate('noContactPersonsYet') +
          (client.is_company ? translate('addThePeopleYouDealWith') : '.'),
        translate('addContact'),
      )}
      {client.is_company &&
        group(
          'participant',
          participants,
          translate('noParticipantsYet'),
          translate('addParticipant'),
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

'use client'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Panel } from '@helvetly/ui/components/panel'
import { PhoneInput } from '@helvetly/ui/components/phone-input'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import {
  displayPhone,
  PHONE_ERROR,
  phoneCountryOr,
  phoneDraft,
  toE164,
  type CountryCode,
} from '@helvetly/ui/lib/phone'
import { cn } from '@helvetly/ui/lib/utils'
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
  UserRoundCheck,
  UsersRound,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
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

/** Where a field's error sits: in the gap below it, so an error never moves the fields around it. */
const fieldClass = 'relative [&>p]:absolute [&>p]:top-full [&>p]:pt-1'

function ContactDialog({
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
  const isContact = roles.includes('contact')
  const required = (key: keyof Draft) => key === 'name' || (key === 'email' && isContact)
  const field = (
    key: Exclude<keyof Draft, 'phone' | 'country'>,
    label: string,
    placeholder: string,
    type = 'text',
  ) => (
    <FormField
      id={`contact-${key}`}
      label={label}
      required={required(key)}
      error={errors[key]}
      className={fieldClass}
    >
      <Input
        {...describedBy(`contact-${key}`, errors[key])}
        type={type}
        value={draft[key]}
        required={required(key)}
        placeholder={placeholder}
        autoComplete={key === 'email' ? 'email' : key === 'name' ? 'name' : 'off'}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
      />
    </FormField>
  )
  const title = contact
    ? isContact
      ? translate('editContact')
      : translate('editParticipant')
    : isContact
      ? translate('addContact2')
      : translate('addParticipantSubmit')
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isContact ? translate('contactDialogHelp') : translate('participantDialogHelp')}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const found = check(draft, roles)
            setErrors(found)
            if (!Object.keys(found).length) onSave(draft, setErrors)
          }}
        >
          <div className="grid gap-x-3 gap-y-6 sm:grid-cols-2">
            {field('name', translate('name'), 'Anna Muster')}
            {field('role', translate('role'), translate('contactRolePlaceholder'))}
            {field('email', translate('email'), 'anna@company.ch', 'email')}
            <FormField
              id="contact-phone"
              label={translate('phone')}
              error={errors.phone}
              className={fieldClass}
            >
              <PhoneInput
                id="contact-phone"
                value={draft.phone}
                country={draft.country}
                invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'contact-phone-error' : undefined}
                onChange={(phone) => setDraft((current) => ({ ...current, phone }))}
                onCountryChange={(code) =>
                  setDraft((current) => ({ ...current, country: phoneCountryOr(code) }))
                }
              />
            </FormField>
            {roles.includes('participant') && (
              <>
                {field('street', translate('participantStreet'), 'Bahnhofstrasse')}
                {field('street_number', translate('participantStreetNumber'), '12')}
                {field('zip', translate('participantZip'), '8001')}
                {field('city', translate('participantCity'), 'Zürich')}
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {contact ? translate('save2') : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
 * company, participants (who take the service). A person can be in both; add and edit in a dialog, roles from the menu.
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

  const link =
    'min-w-0 truncate underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground'
  const row = (contact: Contact) => (
    <li key={contact.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <Initials name={contact.name} className="size-9 text-[11px]" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body-sm font-medium">{contact.name}</span>
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
        </div>
        {contact.role && (
          <span className="truncate text-xs text-muted-foreground">{contact.role}</span>
        )}
        {(contact.email || contact.phone) && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className={link}>
                {contact.email}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className={cn(link, 'tabular-nums')}>
                {displayPhone(contact.phone)}
              </a>
            )}
          </div>
        )}
      </div>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent>{translate('actions')}</TooltipContent>
        </Tooltip>
        <ActionMenuContent
          kind="dropdown"
          menu={{
            header: contact.name,
            actions: contactActions(contact, contacts.length, client.is_company).map((action) => ({
              id: action,
              group: actionGroup(action),
              icon: actionIcon[action],
              label: actionLabel(action),
              onSelect: () => act(contact, action),
            })),
          }}
        />
      </DropdownMenu>
    </li>
  )

  const group = (role: PersonRole, list: Contact[]) => {
    const isContact = role === 'contact'
    const title = isContact ? translate('contacts') : translate('participants')
    const add = isContact ? translate('addContact2') : translate('addParticipantSubmit')
    const open = () => setEditing({ id: 'new', roles: [role] })
    return (
      <section aria-label={title}>
        <Panel
          title={title}
          action={
            list.length > 0 && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={open}>
                <Plus />
                {add}
              </Button>
            )
          }
        >
          {list.length === 0 ? (
            <EmptyState
              icon={isContact ? UsersRound : UserRoundCheck}
              title={isContact ? translate('noContactPersonsYet') : translate('noParticipantsYet')}
              description={
                isContact ? translate('contactsEmptyHelp') : translate('participantsEmptyHelp')
              }
              action={
                <Button variant="outline" size="sm" onClick={open}>
                  <Plus />
                  {add}
                </Button>
              }
              className="py-5"
            />
          ) : (
            <ul className="grid divide-y divide-border/60">{list.map(row)}</ul>
          )}
        </Panel>
      </section>
    )
  }

  const edited =
    editing && editing.id !== 'new' ? people.find((person) => person.id === editing.id) : undefined

  return (
    <div className="grid gap-3">
      {group('contact', contacts)}
      {client.is_company && group('participant', participants)}
      {editing && (editing.id === 'new' || edited) && (
        <ContactDialog
          key={editing.id}
          contact={edited}
          roles={editing.roles}
          clientCountry={client.country}
          pending={save.isPending}
          onSave={submit(edited, editing.roles)}
          onCancel={() => setEditing(null)}
        />
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

import { rolesOf, type Contact, type PersonRole } from '@/lib/clients'

/** Primary first (the server sends it so, but an optimistic change may not), the rest as they were. */
export const sortContacts = (contacts: Contact[]) =>
  contacts.toSorted((a, b) => Number(b.is_primary) - Number(a.is_primary))

export type PersonAction =
  | 'edit'
  | 'primary'
  | 'add-contact'
  | 'remove-contact'
  | 'add-participant'
  | 'remove-participant'
  | 'portal-on'
  | 'portal-off'
  | 'delete'

/**
 * What a person's menu offers. `contacts` counts the client's contacts: the primary one can't be made primary
 * again, and "Make primary" needs two. A role is taken away only while another stays; only a company has
 * participants, and only a participant with an email has a portal switch.
 */
export function contactActions(
  contact: Contact,
  contacts: number,
  isCompany = false,
): PersonAction[] {
  const roles = rolesOf(contact)
  const isContact = roles.includes('contact')
  const isParticipant = roles.includes('participant')
  const actions: PersonAction[] = ['edit']
  if (isContact && !contact.is_primary && contacts >= 2) actions.push('primary')
  if (isCompany) {
    if (!isContact) actions.push('add-contact')
    else if (isParticipant) actions.push('remove-contact')
    if (!isParticipant) actions.push('add-participant')
    else if (isContact) actions.push('remove-participant')
    if (isParticipant && contact.email)
      actions.push(contact.portal_enabled ? 'portal-off' : 'portal-on')
  }
  actions.push('delete')
  return actions
}

/** The roles after a role action. */
export function nextRoles(contact: Contact, action: PersonAction): PersonRole[] {
  const roles = new Set(rolesOf(contact))
  if (action === 'add-contact') roles.add('contact')
  if (action === 'remove-contact') roles.delete('contact')
  if (action === 'add-participant') roles.add('participant')
  if (action === 'remove-participant') roles.delete('participant')
  return (['contact', 'participant'] as const).filter((role) => roles.has(role))
}

/** The list right after "Make primary", before the server answers: exactly one primary. */
export const withPrimary = (contacts: Contact[], id: string) =>
  sortContacts(contacts.map((contact) => ({ ...contact, is_primary: contact.id === id })))

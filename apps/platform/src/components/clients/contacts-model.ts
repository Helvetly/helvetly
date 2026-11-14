import type { Contact } from '@/lib/clients'

/** Primary first (the server sends it so, but an optimistic change may not), the rest as they were. */
export const sortContacts = (contacts: Contact[]) =>
  contacts.toSorted((a, b) => Number(b.is_primary) - Number(a.is_primary))

/** What a contact's menu offers: the primary one can't be made primary again. */
export function contactActions(contact: Contact, count: number): ('edit' | 'primary' | 'delete')[] {
  return ['edit', ...(contact.is_primary || count < 2 ? [] : (['primary'] as const)), 'delete']
}

/** The list right after "Make primary", before the server answers: exactly one primary. */
export const withPrimary = (contacts: Contact[], id: string) =>
  sortContacts(contacts.map((contact) => ({ ...contact, is_primary: contact.id === id })))

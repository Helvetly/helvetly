import type { Contact } from '@/lib/clients'

import { contactActions, nextRoles, sortContacts, withPrimary } from './contacts-model'

const contact = (id: string, is_primary = false, extra: Partial<Contact> = {}): Contact => ({
  id,
  name: id,
  role: null,
  email: null,
  phone: null,
  is_primary,
  ...extra,
})

test('the primary contact comes first, the rest keep their order', () => {
  expect(sortContacts([contact('a'), contact('b'), contact('c', true)]).map((c) => c.id)).toEqual([
    'c',
    'a',
    'b',
  ])
})

test('"Make primary" is offered for every contact but the primary one, and needs two contacts', () => {
  expect(contactActions(contact('a', true), 3)).toEqual(['edit', 'delete'])
  expect(contactActions(contact('b'), 3)).toEqual(['edit', 'primary', 'delete'])
  expect(contactActions(contact('b'), 1)).toEqual(['edit', 'delete'])
})

test('a company person can gain a role, lose one only while another stays, and a participant has a portal switch', () => {
  expect(contactActions(contact('a', true), 1, true)).toEqual(['edit', 'add-participant', 'delete'])
  const both = contact('b', false, { roles: ['contact', 'participant'], email: 'b@x.ch' })
  expect(contactActions(both, 1, true)).toEqual([
    'edit',
    'remove-contact',
    'remove-participant',
    'portal-on',
    'delete',
  ])
  const participant = contact('c', false, {
    roles: ['participant'],
    portal_enabled: true,
    email: 'c@x.ch',
  })
  expect(contactActions(participant, 2, true)).toEqual([
    'edit',
    'add-contact',
    'portal-off',
    'delete',
  ])
  expect(contactActions(contact('d', false, { roles: ['participant'] }), 2, true)).toEqual([
    'edit',
    'add-contact',
    'delete',
  ])
})

test('role actions add or take one role, in a fixed order', () => {
  expect(nextRoles(contact('a'), 'add-participant')).toEqual(['contact', 'participant'])
  expect(
    nextRoles(contact('a', false, { roles: ['participant', 'contact'] }), 'remove-contact'),
  ).toEqual(['participant'])
})

test('making a contact primary leaves exactly one primary, first', () => {
  const next = withPrimary([contact('a', true), contact('b'), contact('c')], 'c')
  expect(next.map((c) => [c.id, c.is_primary])).toEqual([
    ['c', true],
    ['a', false],
    ['b', false],
  ])
})

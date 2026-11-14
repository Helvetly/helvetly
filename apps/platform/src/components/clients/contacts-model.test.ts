import type { Contact } from '@/lib/clients'

import { contactActions, sortContacts, withPrimary } from './contacts-model'

const contact = (id: string, is_primary = false): Contact => ({
  id,
  name: id,
  role: null,
  email: null,
  phone: null,
  is_primary,
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

test('making a contact primary leaves exactly one primary, first', () => {
  const next = withPrimary([contact('a', true), contact('b'), contact('c')], 'c')
  expect(next.map((c) => [c.id, c.is_primary])).toEqual([
    ['c', true],
    ['a', false],
    ['b', false],
  ])
})

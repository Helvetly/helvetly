import { render, screen } from '@testing-library/react'

import { sampleClient } from '@/test/invoice-fixtures'

import { ClientRowStatus, MissingDataBadges, missingData } from './client-bits'

const draft = { is_draft: true, missing_fields: ['street' as const] }

test('what invoicing lacks: the address, then an address to send to (email or billing email)', () => {
  expect(missingData(sampleClient())).toEqual([])
  expect(missingData(sampleClient({ ...draft, email: null }))).toEqual(['address', 'email'])
  expect(missingData(sampleClient({ email: null, billing_email: 'books@acme.ch' }))).toEqual([])
  expect(missingData(sampleClient({ email: null, billing_email: null }))).toEqual(['email'])
})

test('the header shows a chip per gap, the list row only the first', () => {
  const client = sampleClient({ ...draft, email: null })
  const { unmount } = render(<MissingDataBadges client={client} />)
  expect(screen.getByText('Missing address')).toBeInTheDocument()
  expect(screen.getByText('Missing email')).toBeInTheDocument()
  unmount()
  render(<ClientRowStatus client={client} />)
  expect(screen.getByText('Missing address')).toBeInTheDocument()
  expect(screen.queryByText('Missing email')).toBeNull()
})

test.each([
  ['complete and active', sampleClient(), 'Active'],
  ['missing an email', sampleClient({ email: null }), 'Missing email'],
  ['inactive, whatever it lacks', sampleClient({ ...draft, is_active: false }), 'Inactive'],
])('a list row of a client %s reads %s', (_, client, text) => {
  render(<ClientRowStatus client={client} />)
  expect(screen.getByText(text)).toBeInTheDocument()
})

import { sampleClient } from '@/test/invoice-fixtures'

import { clientKind, headerFacts } from './client-header'

test('facts are links, in the order email, phone, location, website', () => {
  const facts = headerFacts(
    sampleClient({ phone: '+41441234567', website: 'https://alpenglow.ch/' }),
  )
  expect(facts.map((fact) => [fact.label, fact.text])).toEqual([
    ['Email', 'hello@alpenglow.ch'],
    ['Phone', '+41 44 123 45 67'],
    ['Location', 'Zürich, Switzerland'],
    ['Website', 'alpenglow.ch'],
  ])
  expect(facts[0]?.href).toBe('mailto:hello@alpenglow.ch')
  expect(facts[1]?.href).toBe('tel:+41441234567')
  expect(facts[2]?.href).toContain(
    encodeURIComponent('Seefeldstrasse 88, 8008 Zürich, Switzerland'),
  )
  expect(facts[3]).toMatchObject({ href: 'https://alpenglow.ch/', external: true })
})

test('a fact the client lacks is left out, so its link never shows', () => {
  const bare = sampleClient({ email: null, phone: null, website: null, city: null, country: null })
  expect(headerFacts(bare)).toEqual([])
  expect(headerFacts(sampleClient({ website: 'alpenglow.ch' })).at(-1)?.href).toBe(
    'https://alpenglow.ch',
  )
})

test.each([
  [{ is_company: true, preferred_name: null }, 'Company'],
  [{ is_company: true, preferred_name: 'Lena Brunner' }, 'Company · contact Lena Brunner'],
  [{ is_company: false, preferred_name: 'Jo' }, 'Person · goes by Jo'],
])('kind of %o is %s', (client, kind) => {
  expect(clientKind(client)).toBe(kind)
})

import { shorten } from './text'

test.each([
  ['Muster GmbH', 'Muster GmbH'],
  ['Exactly sixteen!', 'Exactly sixteen!'],
  ['John Doe Consulting GmbH', 'John Doe Consult…'],
  ['John Doe        Consulting', 'John Doe…'],
  ['Zürich 👩‍👩‍👧‍👦 Familie Müller AG', 'Zürich 👩‍👩‍👧‍👦 Familie…'],
  ['é'.repeat(17), `${'é'.repeat(16)}…`],
])('shorten(%j, 16) is %j', (text, short) => expect(shorten(text, 16)).toBe(short))

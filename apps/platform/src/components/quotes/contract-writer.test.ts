import { sendProblem, stagesFor, toSections, warningText } from './contract-writer'

test('the draft goes to the API without its row keys', () => {
  const draft = {
    title: 'Werkvertrag',
    language: 'de' as const,
    governing_law: 'CH',
    intro: '',
    clauses: [{ heading: 'Gegenstand', body: 'Holzbau.', key: 'section-1' }],
  }
  expect(toSections(draft)).toEqual({
    title: 'Werkvertrag',
    language: 'de',
    governing_law: 'CH',
    intro: '',
    clauses: [{ heading: 'Gegenstand', body: 'Holzbau.' }],
  })
})

test.each([
  ['save', '', [], null],
  ['email', 'ana@example', [], 'Enter a valid email address.'],
  ['email', 'ana@example.com', [], null],
  [
    'signature',
    '',
    [
      { name: 'Anna', email: 'anna@muster.ch' },
      { name: '', email: 'peter@mueller.ch' },
    ],
    'Enter a name.',
  ],
  [
    'signature',
    '',
    [
      { name: 'Anna', email: 'anna@muster.ch' },
      { name: 'Peter', email: 'peter@mueller.ch' },
    ],
    null,
  ],
] as const)('send %s to %j', (delivery, to, signers, problem) => {
  expect(sendProblem(delivery, to, [...signers])).toBe(problem)
})

test('warnings name what to check', () => {
  expect(warningText({ clause: 1, kind: 'amount', text: 'CHF 9.00' })).toBe(
    'CHF 9.00 is not an amount of the quote.',
  )
  expect(warningText({ clause: 0, kind: 'date', text: '01.01.2031' })).toBe(
    '01.01.2031 is not a date of the quote.',
  )
  expect(warningText({ clause: 2, kind: 'personal_data', text: 'a@b.ch' })).toMatch(/a@b\.ch/)
  expect(warningText({ clause: 3, kind: 'statute', text: '§ 280 BGB' })).toMatch(
    /§ 280 BGB is not a statute/,
  )
})

test.each([
  ['ai', false, ['way', 'instructions', 'review', 'send']],
  ['example', false, ['way', 'instructions', 'review', 'send']],
  ['example', true, ['way', 'instructions', 'send']],
  ['template', false, ['way']],
] as const)('%s (as is: %s) takes the steps %j', (mode, asIs, stages) => {
  expect(stagesFor(mode, asIs)).toEqual(stages)
})

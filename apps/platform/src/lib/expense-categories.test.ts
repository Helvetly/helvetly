import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import it from '../messages/it.json'
import { categoryGroup, categoryLabel, PRESET_LABELS, treatmentRate } from './expense-categories'

const keyOf = (preset: string) =>
  `expenseCategory${preset
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join('')}`

test('every preset has its name in all four languages, and no message names a preset the catalogue lacks', () => {
  const expected = Object.keys(PRESET_LABELS).map(keyOf).toSorted()
  expect(expected).toHaveLength(40)
  for (const messages of [en, de, fr, it]) {
    const named = Object.entries(messages).filter(([key]) => /^expenseCategory[A-Z]/.test(key))
    expect(named.map(([key]) => key).toSorted()).toEqual(expected)
    for (const [, text] of named) expect(text.trim()).not.toBe('')
  }
})

test('a preset shows in the user’s language, a named category as stored', () => {
  expect(categoryLabel({ name: 'Travel', preset: 'travel' })).toBe('Travel')
  expect(categoryLabel({ name: 'Lodging', preset: 'lodging' })).toBe(en.expenseCategoryLodging)
  expect(categoryLabel({ name: 'Coworking', preset: null })).toBe('Coworking')
  expect(categoryLabel({ name: 'Old key', preset: 'gone' })).toBe('Old key')
})

test.each([
  ['4000', 'Materials & services'],
  ['5810', 'Staff'],
  ['6105', 'Premises & equipment'],
  ['6210', 'Vehicles'],
  ['6460', 'Insurance, fees & energy'],
  ['6570', 'Administration & IT'],
  ['6641', 'Marketing & travel'],
  ['6700', 'Other'],
  ['6940', 'Finance & taxes'],
  ['8900', 'Finance & taxes'],
  ['1520', 'Other'],
])('account %s sits under %s', (code, heading) => {
  expect(categoryGroup(code)).toBe(heading)
})

test.each([
  ['standard', '2026-11-03', '8.1'],
  ['standard', '2023-12-31', '7.7'],
  ['standard', '', '8.1'],
  ['reduced', '2026-01-01', '2.6'],
  ['lodging', '2024-01-01', '3.8'],
  ['lodging', '2023-06-30', '3.7'],
  ['exempt', '2026-11-03', '0'],
  ['none', '2026-11-03', '0'],
] as const)('%s on %s suggests %s%%', (treatment, date, rate) => {
  expect(treatmentRate(treatment, date)).toBe(rate)
})

test('a category without a treatment suggests nothing', () => {
  expect(treatmentRate(null, '2026-11-03')).toBeNull()
  expect(treatmentRate(undefined, '')).toBeNull()
})

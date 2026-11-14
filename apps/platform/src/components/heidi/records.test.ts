import { progressText, recordsText } from './records'

test('progress reads as used of available, with the unit', () => {
  expect(progressText({ used: '3.500', available: '10.000', unit: 'hour' })).toBe(
    '3.5 of 10 h used',
  )
  expect(progressText({ used: '0', available: '2', unit: '' })).toBe('0 of 2 used')
})

test('records become plain lines for a copied answer', () => {
  expect(
    recordsText([
      { kind: 'client', id: 'c', title: 'John', detail: 'Client 1', status: 'active' },
      {
        kind: 'invoice',
        id: 'i',
        title: '2026-043',
        status: 'overdue',
        amount: '3134.9',
        currency: 'CHF',
      },
      {
        kind: 'engagement',
        id: 'e',
        title: 'Retainer',
        progress: { used: '1', available: '4', unit: 'day' },
      },
    ]),
  ).toBe('- John · Client 1\n- 2026-043 · CHF 3’134.90\n- Retainer · 1 of 4 d used')
})

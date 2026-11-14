import { endedPeriods, exportReasons, vatReturnFileUrl } from './vat-return'

test('lists the ended periods of each length, newest first', () => {
  expect(endedPeriods('quarterly', '2026-11-09', 3)).toEqual(['2026-Q3', '2026-Q2', '2026-Q1'])
  expect(endedPeriods('quarterly', '2026-01-01', 2)).toEqual(['2025-Q4', '2025-Q3'])
  expect(endedPeriods('half_yearly', '2026-11-09', 2)).toEqual(['2026-H1', '2025-H2'])
  expect(endedPeriods('monthly', '2026-01-15', 2)).toEqual(['2025-12', '2025-11'])
  expect(endedPeriods('yearly', '2026-11-09', 2)).toEqual(['2025', '2024'])
})

test('downloads go through a plain link', () => {
  expect(vatReturnFileUrl('2026-Q3', 'pdf')).toBe('/api/v1/vat-return?period=2026-Q3&format=pdf')
})

test('a refused ESTV export lists each reason, ignoring malformed ones', () => {
  expect(
    exportReasons({
      reasons: [{ code: 'uid_missing', message: 'Add your UID.' }, { code: 'x' }, 'bad'],
    }),
  ).toEqual([{ code: 'uid_missing', message: 'Add your UID.' }])
  expect(exportReasons({})).toEqual([])
})

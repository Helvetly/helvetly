import { entriesExportUrl, exportUrl, periodLabel, progressOf, reportUrl } from './engagements'

describe('progressOf', () => {
  it('flags an open period behind pace', () => {
    expect(
      progressOf({ quantity: '30', used: '10', expected: '16', overage: '0', state: 'open' }),
    ).toEqual({ usedPct: 33.33, expectedPct: 53.33, tone: 'warn' })
  })
  it('caps a closed overage at 100', () => {
    expect(progressOf({ quantity: '8', used: '9.5', overage: '1.5', state: 'closed' })).toEqual({
      usedPct: 100,
      expectedPct: 100,
      tone: 'over',
    })
  })
  it('is done when used equals quantity, compared exactly', () => {
    expect(
      progressOf({ quantity: '0.3', used: '0.300', state: 'open', expected: '0.1' }).tone,
    ).toBe('done')
  })
  it('never divides by a zero quantity', () => {
    expect(progressOf({ quantity: '0', used: '0', expected: '0', state: 'open' })).toEqual({
      usedPct: 0,
      expectedPct: 0,
      tone: 'ok',
    })
  })
  it('is ok at exactly 75 % of the expected pace and on an upcoming period', () => {
    expect(progressOf({ quantity: '40', used: '12', expected: '16', state: 'open' }).tone).toBe(
      'ok',
    )
    expect(progressOf({ quantity: '40', used: '0', expected: '0', state: 'upcoming' }).tone).toBe(
      'ok',
    )
  })
})

describe('periodLabel', () => {
  it.each([
    ['2026-11-01', '2026-11-30', '1.–30. Nov 2026'],
    ['2026-10-28', '2026-11-03', '28. Oct – 3. Nov 2026'],
    ['2026-12-28', '2027-01-03', '28. Dec 2026 – 3. Jan 2027'],
    ['2026-11-05', '2026-11-05', '5. Nov 2026'],
  ])('%s – %s', (starts_on, ends_on, label) => {
    expect(periodLabel({ starts_on, ends_on })).toBe(label)
  })
})

describe('progressOf with rollover', () => {
  it('measures against available', () => {
    expect(
      progressOf({
        quantity: '8',
        available: '11',
        used: '10',
        expected: '5.5',
        overage: '0',
        state: 'open',
      }),
    ).toMatchObject({ usedPct: 90.91, expectedPct: 50 })
  })
})

describe('download urls', () => {
  it('builds report and export links', () => {
    expect(reportUrl('eng_1', 'epr_2', true)).toBe(
      '/api/v1/engagements/eng_1/periods/epr_2/report?download=1',
    )
    expect(reportUrl('eng_1', 'epr_2')).toBe('/api/v1/engagements/eng_1/periods/epr_2/report')
    expect(exportUrl({ q: 'a', status: 'active', page: 3, page_size: 50 })).toBe(
      '/api/v1/engagements/export?q=a&status=active',
    )
    expect(entriesExportUrl('eng_1', 'epr_2')).toBe(
      '/api/v1/engagements/eng_1/entries/export?period_id=epr_2',
    )
    expect(entriesExportUrl('eng_1')).toBe('/api/v1/engagements/eng_1/entries/export')
  })
})

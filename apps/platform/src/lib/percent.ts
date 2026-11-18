/**
 * What a percent field shows after a keystroke: digits with one decimal separator and at most two decimals,
 * from 0 to 100. Anything else (a letter, a third decimal, 101) keeps the field as it was.
 */
export function typedPercent(next: string, previous: string): string {
  const value = next.trim()
  if (value === '') return ''
  if (!/^\d{0,3}([.,]\d{0,2})?$/.test(value)) return previous
  return Number(value.replace(',', '.')) > 100 ? previous : value
}

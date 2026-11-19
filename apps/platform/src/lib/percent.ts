/**
 * What a percent field shows after a keystroke or a paste: digits with one decimal separator ("." or ",") and at
 * most two decimals, from 0 to 100. Letters and other characters are dropped, a value above 100 becomes 100, and
 * anything else that is not a percentage (a minus, a third decimal, a second separator) keeps the field as it was.
 * `refused` says the field did not take what was typed, so the field can say why.
 */
export function typedPercent(next: string, previous: string): { value: string; refused: boolean } {
  const text = next.trim().replace(/%/g, '')
  if (text.includes('-')) return { value: previous, refused: true }
  const value = text.replace(/[^\d.,]/g, '')
  if (!/^\d{0,3}([.,]\d{0,2})?$/.test(value)) return { value: previous, refused: true }
  if (Number(value.replace(',', '.')) > 100) return { value: '100', refused: true }
  return { value, refused: value !== text }
}

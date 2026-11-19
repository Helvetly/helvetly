/**
 * What an amount field shows after a keystroke or a paste: digits with "'" as thousands separators and one decimal
 * separator ("." or ",") with at most two decimals. Letters and other characters are dropped; a minus, a third
 * decimal or a second separator keeps the field as it was. `refused` says the field did not take what was typed.
 */
export function typedAmount(next: string, previous: string): { value: string; refused: boolean } {
  const text = next.trim()
  if (text.includes('-')) return { value: previous, refused: true }
  const value = text.replace(/[^\d.,'’]/g, '')
  if (!/^[\d'’]*([.,]\d{0,2})?$/.test(value)) return { value: previous, refused: true }
  return { value, refused: value !== text }
}

// A client's contact and tax fields, checked the same way in the platform's client form and the portal's profile.

/** Roughly an email address: something@domain.tld, the same check the server makes. */
export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

/** A website as typed: an optional http(s):// and a host with a dot ("example.ch"). */
export const isWebsite = (value: string) => /^(https?:\/\/)?[^\s/.]+\.[^\s]+$/i.test(value)

// Swiss UID ("CHE-123.456.789", optionally followed by MWST, TVA or IVA for VAT-registered).

const UID_SUFFIX = /\s*(MWST|TVA|IVA)$/i

/**
 * Formats a Swiss UID as it is typed: "che123456789 mwst" → "CHE-123.456.789 MWST". Anything that
 * doesn't start with CHE (another country's VAT number) is left as typed.
 */
export function formatUid(input: string): string {
  if (!/^\s*che/i.test(input)) return input
  const suffix = input.match(UID_SUFFIX)?.[1]?.toUpperCase()
  const digits = input
    .replace(UID_SUFFIX, '')
    .replace(/^\s*che/i, '')
    .replace(/\D/g, '')
    .slice(0, 9)
  const groups = digits.match(/.{1,3}/g) ?? []
  const number = `CHE${digits ? `-${groups.join('.')}` : ''}`
  if (digits.length < 9) return number
  // The suffix is typed a letter at a time: keep "M", "MW"… while they lead to one.
  const tail = (suffix ?? input.match(/([a-z]+)\s*$/i)?.[1] ?? '').toUpperCase()
  return tail && ['MWST', 'TVA', 'IVA'].some((word) => word.startsWith(tail))
    ? `${number} ${tail}`
    : number
}

/** A complete UID whose check digit is right (eCH-0097: weights 5,4,3,2,7,6,5,4, modulo 11). */
export function isValidUid(value: string): boolean {
  const match = value.trim().match(/^CHE-?(\d{3})\.?(\d{3})\.?(\d{3})(\s+(MWST|TVA|IVA))?$/i)
  if (!match) return false
  const digits = [...`${match[1]}${match[2]}${match[3]}`].map(Number)
  const sum = [5, 4, 3, 2, 7, 6, 5, 4].reduce(
    (total, weight, i) => total + weight * (digits[i] ?? 0),
    0,
  )
  const check = 11 - (sum % 11)
  return check !== 10 && (check === 11 ? 0 : check) === digits[8]
}

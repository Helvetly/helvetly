import {
  displayPhone,
  formatPhoneTyping,
  phoneCountry,
  phoneCountryOr,
  phoneDraft,
  phonePlaceholder,
  toE164,
} from './phone'

test('phone numbers are grouped while typing, and deleting is left alone', () => {
  expect(formatPhoneTyping('78239099', '782390999', 'CH')).toBe('78 239 09 99')
  expect(formatPhoneTyping('078239099', '0782390999', 'CH')).toBe('078 239 09 99')
  expect(formatPhoneTyping('+4930123456', '+49301234567', 'CH')).toBe('+49 30 1234567')
  expect(formatPhoneTyping('78 239 09 99', '78 239 09 9', 'CH')).toBe('78 239 09 9')
  expect(phonePlaceholder('CH')).toBe('78 123 45 67')
  expect(phonePlaceholder('DE')).toBe('1512 3456789')
})

test('valid numbers become E.164, invalid ones null', () => {
  expect(toE164('078 239 09 99', 'CH')).toBe('+41782390999')
  expect(toE164('78 239 09 99', 'CH')).toBe('+41782390999')
  expect(toE164('+49 30 901820', 'CH')).toBe('+4930901820')
  expect(toE164('123', 'CH')).toBeNull()
  expect(phoneCountry('+49 30 901820', 'CH')).toBe('DE')
})

test('a stored number opens in its national format and country, else the fallback country', () => {
  expect(phoneDraft('+41782390999', 'DE')).toEqual({ phone: '078 239 09 99', country: 'CH' })
  expect(phoneDraft(null, 'de')).toEqual({ phone: '', country: 'DE' })
  expect(phoneDraft('', 'XX')).toEqual({ phone: '', country: 'CH' })
  expect(phoneCountryOr(undefined)).toBe('CH')
  expect(displayPhone('+41782390999')).toBe('+41 78 239 09 99')
})

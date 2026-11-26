import { cleanFooter, footerTooLong } from './client-emails'

test('the footer is stored with each line trimmed and its ends cut, as the API stores it', () => {
  expect(cleanFooter('  Office hours  \r\n\r\n IBAN CH93 \n')).toBe('Office hours\n\nIBAN CH93')
  expect(cleanFooter(' \n ')).toBe('')
})

test('the footer holds at most 4 lines and 300 characters, counted after trimming', () => {
  expect(footerTooLong('a\nb\nc\nd')).toBe(false)
  expect(footerTooLong('a\nb\nc\nd\ne')).toBe(true)
  expect(footerTooLong(`${'ä'.repeat(300)}   `)).toBe(false)
  expect(footerTooLong('ä'.repeat(301))).toBe(true)
})

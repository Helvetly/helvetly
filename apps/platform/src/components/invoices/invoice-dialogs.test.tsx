import type { IssueReason } from '@/lib/invoices'

import { issueFixes, recipientErrors } from './invoice-dialogs'

const reasons: IssueReason[] = [
  { code: 'settings_incomplete', field: 'settings.seller.zip', message: 'zip' },
  { code: 'settings_incomplete', field: 'settings.seller.city', message: 'city' },
  { code: 'seller_vat_missing', field: 'settings.seller.vat_number', message: 'vat' },
  { code: 'no_iban', field: 'settings.iban', message: 'iban' },
  { code: 'client_draft', field: 'client.address', message: 'address' },
  { code: 'buyer_vat_missing', field: 'client.vat_number', message: 'client vat' },
  { code: 'no_lines', field: 'lines', message: 'lines' },
]

test('one row per place to fix, each linking to its own settings section', () => {
  const fixes = issueFixes(reasons, 'cli_2')
  expect(fixes.map(({ key, messages }) => [key, messages])).toEqual([
    ['Company details', ['Your company details are missing: ZIP, City.']],
    ['VAT settings', ['vat']],
    ['Bank details', ['iban']],
    ['Complete the client', ['address', 'client vat']],
    ['no_lines:lines', ['lines']],
  ])
  expect(fixes.map((fix) => (fix.action ? 'action' : 'none'))).toEqual([
    'action',
    'action',
    'action',
    'action',
    'none',
  ])
})

test('the editor fixes its own fields inline', () => {
  const fix = vi.fn<(reason: IssueReason) => void>()
  expect(issueFixes(reasons.slice(-1), 'cli_2', fix)[0]?.action).toBeTruthy()
})

test('send dialogs check the recipients before anything goes out', () => {
  expect(recipientErrors('', '')).toEqual({ to: 'Add at least one email address.' })
  expect(recipientErrors('a@b.ch, nope', '')).toEqual({ to: '“nope” isn’t an email address.' })
  expect(recipientErrors('a@b.ch', 'c@d.ch; e@f.ch')).toEqual({})
  expect(recipientErrors('a@b.ch', Array(11).fill('x@y.ch').join(','))).toEqual({
    cc: 'At most 10 addresses in Cc.',
  })
  expect(recipientErrors('a@b.ch', 'nope', '')).toEqual({ cc: '“nope” isn’t an email address.' })
  expect(recipientErrors('a@b.ch', '', 'c@d.ch, e@f.ch')).toEqual({})
  expect(recipientErrors('a@b.ch', '', 'nope')).toEqual({ bcc: '“nope” isn’t an email address.' })
  expect(recipientErrors('a@b.ch', '', Array(11).fill('x@y.ch').join(','))).toEqual({
    bcc: 'At most 10 addresses in Bcc.',
  })
})

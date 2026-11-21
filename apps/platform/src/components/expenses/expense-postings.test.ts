import type { ExpenseLine } from '@/lib/expenses'
import { expense } from '@/stories/pages/api'

import { postingPreview } from './expense-postings'

const line = (id: string, amount: string, account: string | null): ExpenseLine => ({
  id,
  position: 1,
  description: null,
  amount,
  vat_rate: '8.1',
  category: account ? { id: `cat_${account}`, name: account, account_code: account } : null,
  quantity: null,
  unit_price: null,
})

test('one account: the cost without reclaimable VAT, and the VAT to other input tax', () => {
  expect(postingPreview(expense({}))).toEqual([
    { debit: '6640', credit: '2000', amount: '170.77' },
    { debit: '1171', credit: '2000', amount: '13.83' },
  ])
})

test('material costs reclaim to 1170; nothing reclaimable leaves the VAT row out', () => {
  const goods = { id: 'cat_goods', name: 'Goods', account_code: '4000' }
  expect(postingPreview(expense({ category: goods }))[1]).toEqual({
    debit: '1170',
    credit: '2000',
    amount: '13.83',
  })
  expect(
    postingPreview(expense({ base: { ...expense({}).base, deductible_vat: '0.00' } })),
  ).toEqual([{ debit: '6640', credit: '2000', amount: '184.60' }])
})

test('items with their own category share the amounts without losing a cent', () => {
  const rows = postingPreview(
    expense({
      lines: [line('a', '100.00', null), line('b', '84.60', '6510')],
      base: { ...expense({}).base, total: '184.60', deductible_vat: '13.83' },
    }),
  )
  expect(rows.map((row) => row.debit)).toEqual(['6640', '1171', '6510', '1171'])
  const cents = rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0)
  expect(cents).toBe(18460)
})

test('no category, no preview', () => {
  expect(postingPreview(expense({ category: null }))).toEqual([])
})

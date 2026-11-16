import { entry } from '@/mocks/employees'

import { auditLine } from './payroll-entry'

test('the audit line names who created and approved, "a member" without a name', () => {
  expect(auditLine(entry())).toBe('Created by Anna Muster')
  expect(
    auditLine(entry({ approved_by: 'Luca Rossi', approved_by_id: 'usr_2', status: 'approved' })),
  ).toBe('Created by Anna Muster · Approved by Luca Rossi')
  expect(auditLine(entry({ created_by: null, approved_by: null, approved_by_id: 'usr_2' }))).toBe(
    'Created by a member · Approved by a member',
  )
  expect(auditLine(entry({ created_by: null, created_by_id: null }))).toBe('')
})

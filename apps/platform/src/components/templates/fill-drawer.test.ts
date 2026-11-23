import type { Template } from '@/lib/templates'

import { pickableTemplates } from './fill-drawer'

const template = (
  name: string,
  lastUsed: string | null,
  description: string | null = null,
): Template => ({
  id: name,
  name,
  description,
  document: null,
  signers: [],
  fields: [],
  used_count: 0,
  last_used_at: lastUsed,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
})

test('templates are searched by name and description, the most recently used first', () => {
  const all = [
    template('NDA', null),
    template('Service contract', '2026-11-20T10:00:00Z', 'Monthly retainer'),
    template('Agency agreement', '2026-11-22T10:00:00Z'),
    template('Lease', null),
  ]
  expect(pickableTemplates(all, '').map((t) => t.name)).toEqual([
    'Agency agreement',
    'Service contract',
    'Lease',
    'NDA',
  ])
  expect(pickableTemplates(all, 'retainer').map((t) => t.name)).toEqual(['Service contract'])
  expect(pickableTemplates(all, ' service  CONTRACT ').map((t) => t.name)).toEqual([
    'Service contract',
  ])
  expect(pickableTemplates(all, 'missing')).toEqual([])
})

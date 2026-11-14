import type { Client } from './clients'
import {
  buildTemplateBody,
  dataValue,
  defaultSigners,
  generateProblem,
  initialValues,
  templateProblem,
  toDraftFields,
  valuesByField,
  type Template,
  type TemplateDraftField,
} from './templates'

const client: Client = {
  id: 'cli_1',
  number: 7,
  name: 'Société Romande SA',
  preferred_name: null,
  is_company: true,
  is_active: true,
  email: 'info@romande.ch',
  phone: '+41 21 555 00 00',
  street: 'Rue du Lac',
  street_number: '12',
  apt: null,
  zip: '1003',
  city: 'Lausanne',
  country: 'CH',
  internal_id: null,
  note: null,
  website: null,
  vat_number: null,
  language: 'fr',
  currency: 'CHF',
  payment_terms_days: 30,
  tags: [],
  contacts: [
    { id: 'con_1', name: 'Anna Keller', role: null, email: null, phone: null, is_primary: false },
    {
      id: 'con_2',
      name: 'Luc Morel',
      role: 'CEO',
      email: 'luc@romande.ch',
      phone: null,
      is_primary: true,
    },
  ],
  billing_email: null,
  is_draft: false,
  missing_fields: [],
  files_count: 0,
  created_at: '',
  updated_at: '',
}

const box = { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.03 }
const template: Template = {
  id: 'tpl_1',
  name: 'Consulting agreement',
  description: null,
  document: { id: 'doc_1', name: 'Consulting.pdf' },
  signers: [
    { label: 'Client', fill: 'client' },
    { label: 'Us', fill: 'manual' },
  ],
  fields: [
    { ...box, id: 'f1', kind: 'client.name', signer: null, label: null },
    { ...box, id: 'f2', kind: 'client.name', signer: null, label: null, page: 3 },
    { ...box, id: 'f3', kind: 'custom', signer: null, label: 'Project' },
    { ...box, id: 'f4', kind: 'signature', signer: 1, label: null },
  ],
  used_count: 0,
  last_used_at: null,
  created_at: '',
  updated_at: '',
}

test('reads each kind of client data as it is stamped', () => {
  const today = new Date(2026, 10, 7)
  expect(dataValue('client.address', client, today)).toBe('Rue du Lac 12\n1003 Lausanne')
  expect(dataValue('client.number', client, today)).toBe('7')
  expect(dataValue('contact.name', client, today)).toBe('Luc Morel')
  expect(dataValue('client.vat_number', client, today)).toBe('')
  expect(dataValue('today', client, today)).toBe('07.11.2026')
})

test('one value per data kind, one per custom field, sent per field id', () => {
  const values = initialValues(template, client, new Date())
  expect(values).toEqual({ 'client.name': 'Société Romande SA', f3: '' })
  expect(valuesByField(template, { ...values, 'client.name': ' Romande ', f3: 'Website' })).toEqual(
    { f1: 'Romande', f2: 'Romande', f3: 'Website' },
  )
})

test('the client role takes the primary contact, others are left to type', () => {
  expect(defaultSigners(template, client)).toEqual([
    { name: 'Luc Morel', email: 'luc@romande.ch' },
    { name: '', email: '' },
  ])
  expect(defaultSigners(template, { ...client, contacts: [] })[0]).toEqual({
    name: 'Société Romande SA',
    email: 'info@romande.ch',
  })
})

test('lanes round-trip: lane 0 is client data, lane 1 custom fields, lane n + 2 is role n', () => {
  const drafts = toDraftFields(template)
  expect(drafts.map((field) => field.signer)).toEqual([0, 0, 1, 3])
  const body = buildTemplateBody({
    name: ' Consulting ',
    description: ' ',
    documentId: 'doc_1',
    signers: template.signers,
    fields: drafts,
  })
  expect(body.name).toBe('Consulting')
  expect(body.description).toBeNull()
  expect(body.fields.map((field) => [field.kind, field.signer, field.label])).toEqual([
    ['client.name', null, null],
    ['client.name', null, null],
    ['custom', null, 'Project'],
    ['signature', 1, null],
  ])
})

test('the editor asks for a signature field per role and a question per custom field', () => {
  const fields: TemplateDraftField[] = toDraftFields(template)
  const state = { name: 'x', document: { id: 'doc_1' }, signers: template.signers, fields }
  expect(templateProblem(2, state)).toBe('Add a signature field for Client.')
  expect(templateProblem(2, { ...state, signers: [] })).toBeNull()
  expect(
    templateProblem(2, {
      ...state,
      signers: [],
      fields: toDraftFields(template).map((field) => Object.assign(field, { label: null })),
    }),
  ).toBe('Say what to enter in each text field.')
  expect(templateProblem(0, { ...state, document: null })).toMatch(/PDF/)
})

test('filling needs the custom answers, and valid signers when sending to sign', () => {
  const state = {
    template,
    client,
    title: 'Agreement',
    values: { f3: '' },
    delivery: 'signature' as const,
    emailTo: '',
    signers: defaultSigners(template, client),
  }
  expect(generateProblem(0, { ...state, client: null })).toBe('Choose the client.')
  expect(generateProblem(1, state)).toBe('Fill in “Project”.')
  expect(generateProblem(1, { ...state, values: { f3: 'Website' } })).toBeNull()
  expect(generateProblem(2, state)).toMatch(/signers/)
  expect(generateProblem(2, { ...state, delivery: 'email', emailTo: 'luc@romande' })).toMatch(
    /email address/,
  )
})

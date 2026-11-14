import { createEventParser, toHeidiEvent, type HeidiEvent } from './heidi'

const parseAll = (chunks: string[]) => {
  const events: HeidiEvent[] = []
  const parse = createEventParser((event) => events.push(event))
  chunks.forEach(parse)
  return events
}

test('joins a frame cut across chunks', () => {
  expect(
    parseAll([
      'data: {"type":"te',
      'xt","value":"Hi"}\n',
      '\ndata: {"type":"status",',
      '"label":"Looking"}\n\n',
    ]),
  ).toEqual([
    { type: 'text', value: 'Hi' },
    { type: 'status', label: 'Looking' },
  ])
})

test('skips unknown, malformed and invalid frames', () => {
  const events = parseAll([
    'data: {"type":"thinking","value":"x"}\n\n',
    'data: not json\n\n',
    ': keep-alive comment\n\n',
    'data: {"type":"text"}\n\n',
    'data: {"type":"actions","actions":[{"id":"open_client","label":"Open"},{"id":"create_invoice","label":"New"}]}\n\n',
    'data: {"type":"done","usage":{"tokens":42}}\n\n',
  ])
  expect(events).toEqual([
    // open_client without client_id is dropped, the valid action stays.
    { type: 'actions', actions: [{ id: 'create_invoice', label: 'New' }] },
    { type: 'done', usage: { tokens: 42 } },
  ])
})

test('keeps an unfinished frame until its end arrives', () => {
  const events: HeidiEvent[] = []
  const parse = createEventParser((event) => events.push(event))
  parse('data: {"type":"text","value":"a"}')
  expect(events).toHaveLength(0)
  parse('\r\n\r\n')
  expect(events).toEqual([{ type: 'text', value: 'a' }])
})

test('keeps valid records and drops malformed ones', () => {
  const records = [
    { kind: 'client', id: 'c1', title: 'John', detail: 'Client 1', status: 'active' },
    { kind: 'client', id: 'c2', title: 'Ann', status: 'archived' },
    {
      kind: 'invoice',
      id: 'i1',
      title: '2026-001',
      status: 'overdue',
      amount: '12.50',
      currency: 'CHF',
    },
    { kind: 'invoice', id: 'i2', title: '2026-002', status: 'overdue', currency: 'CHF' },
    { kind: 'invoice', id: 'i3', title: '2026-003', status: 'lost', amount: '1', currency: 'CHF' },
    { kind: 'engagement', id: 'e1', title: 'Retainer' },
    {
      kind: 'engagement',
      id: 'e2',
      title: 'Support',
      progress: { used: '1', available: '4', unit: 'hour' },
    },
    { kind: 'engagement', id: 'e3', title: 'Bad', progress: { used: 1 } },
    { kind: 'expense', id: 'x1', title: 'Lunch' },
    { kind: 'client', id: 'c3', title: 'Detail', detail: 3, status: 'active' },
  ]
  const [event] = parseAll([`data: ${JSON.stringify({ type: 'records', records })}\n\n`])
  expect(event).toEqual({
    type: 'records',
    records: [
      { kind: 'client', id: 'c1', title: 'John', detail: 'Client 1', status: 'active' },
      {
        kind: 'invoice',
        id: 'i1',
        title: '2026-001',
        detail: undefined,
        status: 'overdue',
        amount: '12.50',
        currency: 'CHF',
      },
      { kind: 'engagement', id: 'e1', title: 'Retainer', detail: undefined },
      {
        kind: 'engagement',
        id: 'e2',
        title: 'Support',
        detail: undefined,
        progress: { used: '1', available: '4', unit: 'hour' },
      },
    ],
  })
})

test('caps the records of one answer', () => {
  const records = Array.from({ length: 30 }, (_, index) => ({
    kind: 'client',
    id: `c${index}`,
    title: `Client ${index}`,
    status: 'active',
  }))
  const [event] = parseAll([`data: ${JSON.stringify({ type: 'records', records })}\n\n`])
  expect(event?.type === 'records' && event.records).toHaveLength(20)
})

test('keeps who generated an answer and drops an unknown marker', () => {
  expect(toHeidiEvent({ type: 'text', value: 'a', generated_by: 'model' })).toEqual({
    type: 'text',
    value: 'a',
    generated_by: 'model',
  })
  expect(toHeidiEvent({ type: 'text', value: 'a', generated_by: 'helvetly' })).toEqual({
    type: 'text',
    value: 'a',
    generated_by: 'helvetly',
  })
  expect(toHeidiEvent({ type: 'text', value: 'a', generated_by: 'gpt' })).toEqual({
    type: 'text',
    value: 'a',
  })
})

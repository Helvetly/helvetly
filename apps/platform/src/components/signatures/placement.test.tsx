import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Hash, User } from 'lucide-react'
import { useState } from 'react'

import type { DraftField } from '@/lib/signatures'

import { Placement, type Palette } from './placement'

vi.mock('@/components/invoices/pdf-view', () => ({
  PdfView: ({ overlay }: { overlay: (page: number) => React.ReactNode }) => (
    <div>
      {overlay(1)}
      {overlay(2)}
    </div>
  ),
}))

type Kind = 'name' | 'note'
const palette: Palette<Kind> = {
  lanes: [
    { id: 'data', name: 'Client data' },
    { id: 'buyer', name: 'Buyer' },
  ],
  kinds: () => ['name', 'note'],
  label: (kind) => (kind === 'name' ? 'Client name' : 'Ask when filling'),
  icon: (kind) => (kind === 'name' ? User : Hash),
  prompt: (kind) => (kind === 'note' ? 'What to ask for' : null),
  hint: 'Hint',
}
const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.05, label: null }
const start: DraftField<Kind>[] = [
  { key: 'a', kind: 'name', signer: 0, page: 2, ...box },
  { key: 'b', kind: 'note', signer: 0, page: 1, ...box, label: 'Job title' },
  { key: 'c', kind: 'name', signer: 1, page: 1, ...box },
]

function Harness({ initial }: { initial: DraftField<Kind>[] }) {
  const [fields, setFields] = useState(initial)
  const [active, setActive] = useState(0)
  return (
    <Placement
      src="/x.pdf"
      title="x"
      palette={palette}
      fields={fields}
      onFields={setFields}
      active={active}
      onActive={setActive}
      onPages={() => {}}
    />
  )
}

const list = () => screen.getByRole('region', { name: 'In this document' })

test('lists placed fields by lane with page numbers and counts', () => {
  render(<Harness initial={start} />)

  const client = within(list()).getByRole('list', { name: 'Client data' })
  const items = within(client).getAllByRole('listitem')
  expect(items.map((item) => item.textContent)).toEqual(['Job titlep. 1', 'Client namep. 2'])
  expect(within(list()).getByText('2', { selector: 'p > span' })).toBeTruthy()
  expect(within(within(list()).getByRole('list', { name: 'Buyer' })).getByText('p. 1')).toBeTruthy()
})

test('clicking an item selects that field', async () => {
  render(<Harness initial={start} />)

  const item = within(list()).getByRole('button', { name: /^Job title/ })
  expect(item.getAttribute('aria-current')).toBeNull()
  await userEvent.click(item)

  expect(item.getAttribute('aria-current')).toBe('true')
})

test('the remove button takes that placement out', async () => {
  render(<Harness initial={start} />)

  await userEvent.click(within(list()).getByRole('button', { name: 'Remove Client name, page 2' }))

  expect(within(list()).queryByText('p. 2')).toBeNull()
  expect(within(list()).getAllByRole('listitem')).toHaveLength(2)
})

test('says what to do while nothing is placed', () => {
  render(<Harness initial={[]} />)

  expect(within(list()).getByText(/Drag fields onto the page/)).toBeTruthy()
})

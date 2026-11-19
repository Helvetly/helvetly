import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import type { PickedLine, Product } from '@/lib/products'

import { newLine, type EditorLine } from './editor-model'
import { LinesEditor, needsPrice } from './lines-editor'

const picked = vi.hoisted(() => ({
  line: null as PickedLine | null,
  currency: 'EUR',
}))
vi.mock('@/components/products/product-picker', () => ({
  // Only the product's currency matters to the grid.
  ProductPicker: ({
    onPick,
  }: {
    onPick: (line: PickedLine, product: Pick<Product, 'currency'>) => void
  }) => (
    <button
      type="button"
      onClick={() => picked.line && onPick(picked.line, { currency: picked.currency })}
    >
      Pick product
    </button>
  ),
}))

let latest: EditorLine[] = []
function Harness({ initial }: { initial: EditorLine[] }) {
  const [lines, setLines] = useState(initial)
  return (
    <LinesEditor
      lines={lines}
      vatMode="exclusive"
      defaultRate="8.1"
      amounts={lines.map(() => '0.00')}
      errors={{}}
      onChange={(next) => {
        latest = next
        setLines(next)
      }}
      currency="CHF"
    />
  )
}

const blank = () => newLine({ vat_mode: 'exclusive' }, '8.1')

beforeEach(() => {
  picked.line = {
    description: 'Workshop',
    quantity: '1',
    unit: 'day',
    unit_price: '100.00',
    vat_category: 'S',
    vat_rate: '8.1',
  }
  picked.currency = 'EUR'
})

describe('LinesEditor', () => {
  it('leaves the price empty for a product in another currency until one is typed', async () => {
    render(<Harness initial={[blank()]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Pick product' }))
    const price = screen.getByLabelText('Line 1 price')
    expect((price as HTMLInputElement).value).toBe('')
    expect(screen.getByText('Priced in EUR. Enter the CHF price.')).toBeTruthy()
    expect(price.getAttribute('aria-invalid')).toBe('true')
    expect(latest.some(needsPrice)).toBe(true)

    await userEvent.type(price, '95')
    expect(screen.queryByText(/Priced in EUR/)).toBeNull()
    expect(latest.some(needsPrice)).toBe(false)
  })

  it('gives an added line the same description hint as the first', async () => {
    render(<Harness initial={[blank()]} />)
    await userEvent.click(screen.getByRole('button', { name: /Add line/ }))
    const hint = 'What did you deliver? e.g. Website design'
    expect(screen.getByLabelText('Line 1 description').getAttribute('placeholder')).toBe(hint)
    expect(screen.getByLabelText('Line 2 description').getAttribute('placeholder')).toBe(hint)
  })

  it('keeps the price of a product in the invoice currency', async () => {
    picked.currency = 'CHF'
    render(<Harness initial={[blank()]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Pick product' }))
    expect((screen.getByLabelText('Line 1 price') as HTMLInputElement).value).toBe('100.00')
  })

  it('asks for an exemption code on exempt lines and pre-fills reverse charge', async () => {
    render(
      <Harness
        initial={[
          { ...blank(), vat_category: 'E', vat_rate: '0' },
          { ...blank(), vat_category: 'AE', vat_rate: '0', vat_exemption_code: 'VATEX-EU-AE' },
          blank(),
        ]}
      />,
    )
    const exempt = screen.getByLabelText('Line 1 VAT exemption code')
    expect(exempt.getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByLabelText('Line 2 VAT exemption code') as HTMLSelectElement).value).toBe(
      'VATEX-EU-AE',
    )
    expect(screen.queryByLabelText('Line 3 VAT exemption code')).toBeNull()

    await userEvent.selectOptions(exempt, 'VATEX-EU-132-1A')
    expect(latest[0]?.vat_exemption_code).toBe('VATEX-EU-132-1A')
    expect(exempt.getAttribute('aria-invalid')).toBeNull()
    const reason = screen.getByLabelText('Line 1 VAT exemption reason')
    expect(reason.getAttribute('maxLength')).toBe('300')
    await userEvent.type(reason, 'Art. 21 MWSTG')
    expect(latest[0]?.vat_exemption_reason).toBe('Art. 21 MWSTG')
    expect(screen.queryByLabelText('Line 3 VAT exemption reason')).toBeNull()
  })
})

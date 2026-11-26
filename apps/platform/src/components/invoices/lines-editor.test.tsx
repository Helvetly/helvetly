import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import type { VatMode } from '@/lib/invoices'
import type { PickedLine, Product } from '@/lib/products'
import { sampleSettings } from '@/test/invoice-api'

import { changeVatMode, emptyValues, newLine, toInput, type EditorLine } from './editor-model'
import { LinesEditor, needsPrice } from './lines-editor'

const picked = vi.hoisted(() => ({
  line: null as PickedLine | null,
  currency: 'EUR',
  basis: 'net' as 'net' | 'gross',
  unit: '100.00',
}))
vi.mock('@/components/products/product-picker', () => ({
  ProductPicker: ({
    onPick,
  }: {
    onPick: (
      line: PickedLine,
      product: Pick<Product, 'currency' | 'price_basis' | 'unit_price'>,
    ) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        picked.line &&
        onPick(picked.line, {
          currency: picked.currency,
          price_basis: picked.basis,
          unit_price: picked.unit,
        })
      }
    >
      Pick product
    </button>
  ),
}))

let latest: EditorLine[] = []
function Harness({ initial, currency = 'CHF' }: { initial: EditorLine[]; currency?: string }) {
  const [mode, setMode] = useState<VatMode>('exclusive')
  const [lines, setLines] = useState(initial)
  return (
    <LinesEditor
      lines={lines}
      vatMode={mode}
      onChangeBasis={(next) => {
        const changed = changeVatMode(
          { ...emptyValues(sampleSettings()), lines, currency, vat_mode: mode },
          next,
          '8.1',
        )
        latest = changed.lines
        setMode(next)
        setLines(latest)
      }}
      defaultRate="8.1"
      amounts={lines.map(() => '0.00')}
      errors={{}}
      onChange={(next) => {
        latest = next
        setLines(next)
      }}
      currency={currency}
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
  picked.unit = '100.00'
  picked.basis = 'net'
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

  it('requires a choice for a rounded catalogue price at the entered quantity', async () => {
    picked.unit = '0.07'
    picked.basis = 'gross'
    render(<Harness initial={[blank()]} currency="EUR" />)
    await userEvent.click(screen.getByRole('button', { name: 'Pick product' }))
    const quantity = screen.getByLabelText('Line 1 quantity')
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '1000')
    const values = () => ({
      ...emptyValues(sampleSettings()),
      currency: 'EUR',
      vat_mode: 'exclusive' as const,
      lines: latest,
    })
    expect(screen.getByRole('status')).toHaveTextContent('EUR 70.00')
    expect(screen.getByRole('status')).toHaveTextContent('−EUR 5.14')
    expect(Object.keys(toInput(values()).errors)).toContain(`${latest[0]?.key}.unit_price`)
    await userEvent.click(screen.getByRole('button', { name: 'Use EUR 64.86' }))
    expect(toInput(values()).errors).toEqual({})
    expect(toInput(values()).input.lines?.[0]?.unit_price).toBe('0.06')
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '1000')
    await userEvent.click(screen.getByRole('button', { name: /Keep EUR 70.00/ }))
    expect(latest[0]?.unit_price).toBe('0.07')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('gives an added line the same description hint as the first', async () => {
    render(<Harness initial={[blank()]} />)
    await userEvent.click(screen.getByRole('button', { name: /Add line/ }))
    const hint = 'What did you deliver? e.g. Website design'
    expect(screen.getByLabelText('Line 1 description').getAttribute('placeholder')).toBe(hint)
    expect(screen.getByLabelText('Line 2 description').getAttribute('placeholder')).toBe(hint)
  })

  it('resolves a catalogue price on a mixed invoice without repricing its manual line', async () => {
    const manual = { ...blank(), description: 'Delivery', unit_price: '12.34' }
    picked.unit = '0.07'
    picked.basis = 'gross'
    render(<Harness initial={[manual]} currency="EUR" />)
    await userEvent.click(screen.getByRole('button', { name: 'Pick product' }))
    const quantity = screen.getByLabelText('Line 2 quantity')
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '1000')
    expect(screen.queryByRole('button', { name: /Keep EUR/ })).toBeNull()
    expect(screen.getByText(/use a document with VAT-inclusive prices/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Use EUR 64.86' }))
    expect(latest[0]).toEqual(manual)
    expect(latest[1]?.unit_price).toBe('0.06')
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

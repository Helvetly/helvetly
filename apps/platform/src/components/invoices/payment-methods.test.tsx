import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { InvoiceSettings, PaymentMethods } from '@/lib/invoices'
import { sampleInvoice, sampleSettings } from '@/test/invoice-api'

import { PaymentMarks, PaymentSummary, PaymentToggles } from './payment-methods'

function setup(settings: InvoiceSettings, currency = 'CHF', value?: PaymentMethods) {
  const onChange = vi.fn<(value: PaymentMethods) => void>()
  render(
    <TooltipProvider>
      <PaymentToggles
        settings={settings}
        currency={currency}
        value={value ?? { qr_bill: true, revolut: false }}
        onChange={onChange}
      />
    </TooltipProvider>,
  )
  return onChange
}

const revolut = { revolut_enabled: true, revolut_username: 'muster' }

test('toggles each enabled method on its own', async () => {
  const onChange = setup(sampleSettings({ iban: 'CH9300762011623852957', ...revolut }))
  expect(screen.getByRole('checkbox', { name: 'QR bill' })).toBeChecked()
  const toggle = screen.getByRole('checkbox', { name: 'Revolut' })
  expect(toggle).not.toBeChecked()
  await userEvent.click(toggle)
  expect(onChange).toHaveBeenLastCalledWith({ qr_bill: true, revolut: true })
})

test('shows only what the settings enable', () => {
  setup(sampleSettings({ iban: 'CH9300762011623852957' }))
  expect(screen.getByRole('checkbox', { name: 'QR bill' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Revolut' })).not.toBeInTheDocument()
})

test('turns the QR bill off, with the reason, where it cannot exist', async () => {
  setup(sampleSettings({ iban: 'CH9300762011623852957' }), 'USD')
  const toggle = screen.getByRole('checkbox', { name: 'QR bill' })
  expect(toggle).toBeDisabled()
  expect(toggle).not.toBeChecked()
  await userEvent.hover(toggle.closest('label') ?? toggle)
  expect((await screen.findAllByText('Only for CHF and EUR, not USD.')).length).toBeGreaterThan(0)
})

test('offers to set up each method that is not enabled, Revolut included', () => {
  setup(sampleSettings({ qr_bill_enabled: false, revolut_enabled: false }))
  expect(screen.getByRole('link', { name: 'QR bill' })).toHaveAttribute(
    'href',
    '/settings/invoices?focus=qr_bill_enabled',
  )
  expect(screen.getByRole('link', { name: 'Revolut' })).toHaveAttribute(
    'href',
    '/settings/invoices?focus=revolut_enabled',
  )
})

test('marks a list row with the methods it offers, and nothing for bank details only', () => {
  const { rerender } = render(
    <TooltipProvider>
      <PaymentMarks methods={{ qr_bill: true, revolut: true }} />
    </TooltipProvider>,
  )
  expect(screen.getByText('Swiss QR bill')).toBeInTheDocument()
  expect(screen.getByText('Revolut')).toBeInTheDocument()
  rerender(
    <TooltipProvider>
      <PaymentMarks methods={{ qr_bill: false, revolut: false }} />
    </TooltipProvider>,
  )
  expect(screen.queryByText('Swiss QR bill')).not.toBeInTheDocument()
})

test('the drawer shows the frozen Revolut link and copies it', async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const { payment } = sampleInvoice()
  render(<PaymentSummary payment={{ ...payment, revolut_url: 'https://revolut.me/muster' }} />)
  expect(screen.getByText('Swiss QR bill · Revolut')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'revolut.me/muster' })).toHaveAttribute(
    'href',
    'https://revolut.me/muster',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Copy the Revolut link' }))
  expect(writeText).toHaveBeenCalledWith('https://revolut.me/muster')
})

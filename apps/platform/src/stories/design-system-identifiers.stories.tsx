import { Input } from '@helvetly/ui/components/input'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

const meta = {
  title: 'Design system/Identifiers',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** `font-code`: identifiers and codes only, never names, dates, amounts or prose. */
export const FontCode: Story = {
  render: () => (
    <div className="grid max-w-md gap-4 text-body">
      <p data-testid="primary">
        <span className="font-code">2026/INV/004</span> · Muster AG · 20 Nov 2026 · CHF 219.80
      </p>
      <p className="grid">
        <span>20 Jan 2027</span>
        <span data-testid="secondary" className="font-code text-caption text-muted-foreground">
          RF15 2026 0000 0402
        </span>
      </p>
      <p>
        IBAN <span className="font-code">CH93 0076 2011 6238 5295 7</span>
      </p>
      <Input aria-label="SKU" className="font-code" defaultValue="SKU-00042" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = canvas.getByText('2026/INV/004')
    const parentSize = parseFloat(getComputedStyle(canvas.getByTestId('primary')).fontSize)
    // Mono steps down a little next to the sans it sits in.
    await expect(parseFloat(getComputedStyle(number).fontSize)).toBeCloseTo(parentSize * 0.9, 1)
    await expect(getComputedStyle(number).fontVariantNumeric).toContain('tabular-nums')
    await expect(getComputedStyle(number).fontFamily).not.toBe(
      getComputedStyle(canvas.getByTestId('primary')).fontFamily,
    )
    // A text-* size wins over the step down, and an input keeps its own size.
    await expect(getComputedStyle(canvas.getByTestId('secondary')).fontSize).toBe('12px')
    const input = canvas.getByLabelText('SKU')
    await expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(14)
  },
}

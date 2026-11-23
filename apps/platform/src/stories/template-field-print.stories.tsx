import { Button } from '@helvetly/ui/components/button'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState, type ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { FieldBox } from '@/components/signatures/parts'
import type { Box } from '@/lib/signatures'

const meta = {
  title: 'Templates/Printed fields',
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const BLUE = '#1d4ed8'

/** A white A4 page 420 px wide, as in the template preview. */
function Page({ children }: { children: ReactNode }) {
  return (
    <div className="relative aspect-[1/1.414] w-[420px] bg-white shadow-elevation-1">
      {children}
    </div>
  )
}

const boxAt = (y: number, h: number, w = 0.4): Box => ({ page: 1, x: 0.1, y, w, h })

const fontSize = (element: HTMLElement) => parseFloat(getComputedStyle(element).fontSize)
const printed = (canvas: HTMLElement, text: string) => {
  const span = within(canvas).getByText(text)
  const box = span.closest<HTMLElement>('[data-mode]')
  if (!box) throw new Error(`no field box around ${text}`)
  return { span, box }
}

// A filled field shows only its value, black and without the editor's coloured box.
export const OutputWithoutChrome: Story = {
  render: () => (
    <Page>
      <FieldBox box={boxAt(0.1, 0.03)} kind="client.name" color={BLUE}>
        <span className="truncate px-1.5 font-medium">Client name</span>
      </FieldBox>
      <FieldBox box={boxAt(0.15, 0.03)} kind="client.name" color={BLUE} mode="output">
        Müller AG
      </FieldBox>
    </Page>
  ),
  play: async ({ canvasElement }) => {
    const edit = within(canvasElement).getByText('Client name').closest<HTMLElement>('[data-mode]')
    await expect(edit).toHaveAttribute('data-mode', 'edit')
    await expect(getComputedStyle(edit as HTMLElement).borderTopWidth).toBe('1px')

    const { span, box } = printed(canvasElement, 'Müller AG')
    const style = getComputedStyle(box)
    await expect(box).toHaveAttribute('data-mode', 'output')
    await expect(style.borderTopWidth).toBe('0px')
    await expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    await expect(getComputedStyle(span).color).toBe('rgb(0, 0, 0)')
    // left aligned at the box's edge, vertically centred
    const [outer, inner] = [box.getBoundingClientRect(), span.getBoundingClientRect()]
    await expect(Math.abs(inner.left - outer.left)).toBeLessThan(1)
    await expect(Math.abs(inner.top - outer.top - (outer.bottom - inner.bottom))).toBeLessThan(1)
  },
}

/** 10 pt on this 420 px A4 page (595.28 pt wide). */
const TEN_POINTS = (10 * 420) / 595.28

// Every value prints at its field's size in points, 10 by default, whatever its box: a larger box changes nothing.
export const SizeIsTheFieldsNotTheBoxes: Story = {
  render: function Render() {
    const [h, setH] = useState(0.03)
    return (
      <div className="grid justify-items-start gap-3">
        <Button variant="outline" onClick={() => setH(0.06)}>
          Larger box
        </Button>
        <Page>
          <FieldBox box={boxAt(0.1, h, 0.6)} kind="client.email" color={BLUE} mode="output">
            ana@example.com
          </FieldBox>
          <FieldBox box={boxAt(0.2, 0.08, 0.6)} kind="client.name" color={BLUE} mode="output">
            Müller AG
          </FieldBox>
          <FieldBox
            box={boxAt(0.3, 0.03, 0.6)}
            kind="today"
            color={BLUE}
            mode="output"
            print={{ font_size: 14 }}
          >
            23.11.2026
          </FieldBox>
        </Page>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const email = printed(canvasElement, 'ana@example.com').span
    const name = printed(canvasElement, 'Müller AG').span
    await expect(fontSize(email)).toBeCloseTo(TEN_POINTS, 1)
    await expect(fontSize(name)).toBeCloseTo(TEN_POINTS, 1)
    await expect(fontSize(printed(canvasElement, '23.11.2026').span)).toBeCloseTo(
      TEN_POINTS * 1.4,
      1,
    )
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Larger box' }))
    await waitFor(() =>
      expect(printed(canvasElement, 'ana@example.com').box.style.height).toBe('6%'),
    )
    await expect(fontSize(email)).toBeCloseTo(TEN_POINTS, 1)
  },
}

// Auto-fit shrinks a value wider than its box to the box, never above the field's size; without it the size holds.
export const AutoFitShrinksLongValues: Story = {
  render: () => (
    <Page>
      <FieldBox
        box={boxAt(0.1, 0.04, 0.3)}
        kind="client.name"
        color={BLUE}
        mode="output"
        print={{ font_size: 24, auto_fit: true }}
      >
        Müller Schreinerei und Innenausbau AG
      </FieldBox>
      <FieldBox
        box={boxAt(0.2, 0.04, 0.6)}
        kind="client.city"
        color={BLUE}
        mode="output"
        print={{ font_size: 12, auto_fit: true }}
      >
        Bern
      </FieldBox>
    </Page>
  ),
  play: async ({ canvasElement }) => {
    const { span, box } = printed(canvasElement, 'Müller Schreinerei und Innenausbau AG')
    await expect(fontSize(span)).toBeLessThan(TEN_POINTS * 2.4)
    await expect(span.offsetWidth).toBeLessThanOrEqual(box.clientWidth + 0.5)
    // a short value keeps its size: auto-fit never grows it to the box
    await expect(fontSize(printed(canvasElement, 'Bern').span)).toBeCloseTo(TEN_POINTS * 1.2, 1)
  },
}

// Centred and right-aligned values sit in the middle and at the right edge of their boxes.
export const Alignment: Story = {
  render: () => (
    <Page>
      <FieldBox
        box={boxAt(0.1, 0.03, 0.6)}
        kind="client.name"
        color={BLUE}
        mode="output"
        print={{ align: 'center' }}
      >
        Centred AG
      </FieldBox>
      <FieldBox
        box={boxAt(0.2, 0.03, 0.6)}
        kind="client.name"
        color={BLUE}
        mode="output"
        print={{ align: 'right' }}
      >
        Right AG
      </FieldBox>
    </Page>
  ),
  play: async ({ canvasElement }) => {
    const centred = printed(canvasElement, 'Centred AG')
    const [outer, inner] = [
      centred.box.getBoundingClientRect(),
      centred.span.getBoundingClientRect(),
    ]
    await expect(Math.abs(inner.left - outer.left - (outer.right - inner.right))).toBeLessThan(1.5)
    const right = printed(canvasElement, 'Right AG')
    await expect(
      Math.abs(right.box.getBoundingClientRect().right - right.span.getBoundingClientRect().right),
    ).toBeLessThan(1)
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { PercentInput } from './percent-input'

const meta = { title: 'Shared/Percent input', parameters: { layout: 'padded' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Field({ initial = '', cell = false }: { initial?: string; cell?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="flex w-64 flex-col gap-10">
      <PercentInput
        aria-label="Rate"
        value={value}
        onValueChange={setValue}
        placeholder="8.1"
        inputClassName={
          cell
            ? 'field-quiet h-8 w-full rounded-md bg-transparent px-2 text-right tabular-nums outline-none focus:bg-card focus:ring-2 focus:ring-ring/40'
            : undefined
        }
      />
      <p className="text-caption text-muted-foreground">Next field stays put</p>
    </div>
  )
}

/** Letters are refused while one types, with a hint under the field; only the number is kept. */
export const TypingLetters: Story = {
  render: () => <Field />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rate = canvas.getByLabelText('Rate')
    await expect(rate).toHaveAttribute('inputmode', 'decimal')
    await expect(rate.parentElement).toHaveTextContent('%')
    const below = canvas.getByText('Next field stays put')
    const top = below.getBoundingClientRect().top
    await userEvent.type(rate, 'kkk')
    await expect(rate).toHaveValue('')
    await expect(
      canvas.getByText('A number from 0 to 100, with at most two decimals.'),
    ).toBeVisible()
    await expect(below.getBoundingClientRect().top).toBe(top)
    await userEvent.type(rate, '2.6')
    await expect(rate).toHaveValue('2.6')
    await expect(
      canvas.queryByText('A number from 0 to 100, with at most two decimals.'),
    ).toBeNull()
  },
}

/** More than 100 becomes 100, and says why; a minus or a third decimal is refused. */
export const OutOfRange: Story = {
  render: () => <Field cell />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rate = canvas.getByLabelText('Rate')
    await expect(rate.parentElement).toHaveTextContent('%')
    await userEvent.type(rate, '150')
    await expect(rate).toHaveValue('100')
    await expect(
      canvas.getByText('A number from 0 to 100, with at most two decimals.'),
    ).toBeVisible()
    await expect(rate).toHaveAccessibleDescription(
      'A number from 0 to 100, with at most two decimals.',
    )
    await userEvent.clear(rate)
    await userEvent.type(rate, '-12.345')
    await expect(rate).toHaveValue('12.34')
    await userEvent.tab()
    await expect(
      canvas.queryByText('A number from 0 to 100, with at most two decimals.'),
    ).toBeNull()
  },
}

/** A decimal comma is a decimal separator, as typed in de, fr and it. */
export const DecimalComma: Story = {
  render: () => <Field />,
  play: async ({ canvasElement }) => {
    const rate = within(canvasElement).getByLabelText('Rate')
    await userEvent.type(rate, '12,5')
    await expect(rate).toHaveValue('12,5')
  },
}

/** A pasted value keeps only its number: letters and the % sign go, more than 100 becomes 100. */
export const Paste: Story = {
  render: () => <Field initial="5" />,
  play: async ({ canvasElement }) => {
    const rate = within(canvasElement).getByLabelText('Rate')
    await userEvent.tripleClick(rate)
    await userEvent.paste('kkk2.6')
    await expect(rate).toHaveValue('2.6')
    await userEvent.tripleClick(rate)
    await userEvent.paste('7.7 %')
    await expect(rate).toHaveValue('7.7')
    await userEvent.tripleClick(rate)
    await userEvent.paste('250')
    await expect(rate).toHaveValue('100')
  },
}

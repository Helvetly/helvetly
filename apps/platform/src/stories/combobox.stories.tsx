import { Combobox, type Option } from '@helvetly/ui/components/combobox'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

const make = (count: number): Option[] =>
  Array.from({ length: count }, (_, index) => ({
    value: `v${index + 1}`,
    label: `Option ${String(index + 1).padStart(2, '0')}`,
  }))

const NONE: string[] = []
const FRUIT: Option[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
]

function Single({
  options,
  initial = '',
  searchable,
}: {
  options: Option[]
  initial?: string
  searchable?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="w-72 p-4">
      <Combobox
        value={value}
        options={options}
        label="Pick"
        placeholder="Any…"
        searchable={searchable}
        onChange={setValue}
        onClear={() => setValue('')}
        clearLabel="Clear pick"
      />
      <output aria-label="Value">{value}</output>
    </div>
  )
}

function Multi({ options, initial = NONE }: { options: Option[]; initial?: string[] }) {
  const [values, setValues] = useState(initial)
  return (
    <div className="w-72 p-4">
      <Combobox
        value=""
        values={values}
        options={options}
        label="Tags"
        placeholder="Any tag…"
        onChange={(value) =>
          setValues((current) =>
            current.includes(value)
              ? current.filter((entry) => entry !== value)
              : [...current, value],
          )
        }
        onClear={() => setValues([])}
        clearLabel="Clear tags"
      />
      <output aria-label="Values">{values.join(',')}</output>
    </div>
  )
}

const meta = { title: 'Controls/Combobox' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** The clear × sits before the chevron; chevron and × form one tight group at the field's inner padding. */
export const ClearBeforeChevron: Story = {
  render: () => <Single options={FRUIT} initial="banana" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: /Pick/ })
    const clear = canvas.getByRole('button', { name: 'Clear pick' })
    const chevron = trigger.querySelector('svg')
    if (!chevron) throw new Error('no chevron')
    const field = trigger.getBoundingClientRect()
    const x = clear.getBoundingClientRect()
    const c = chevron.getBoundingClientRect()
    await expect(x.right).toBeLessThanOrEqual(c.left + 1)
    // No trailing gap: the chevron ends at the field's 12 px inner padding (plus the 1 px border).
    await expect(Math.abs(field.right - c.right - 13)).toBeLessThanOrEqual(1.5)
    await expect(Math.round(field.height)).toBe(36)
    await userEvent.click(clear)
    await expect(canvas.getByRole('status', { name: 'Value' })).toHaveTextContent('')
    await expect(canvas.queryByRole('button', { name: 'Clear pick' })).toBeNull()
  },
}
export const ClearBeforeChevronDark: Story = { ...ClearBeforeChevron, parameters: { dark: true } }

/** Two options need no search box; twenty do, and a caller can force it either way. */
export const SearchOnlyForLongLists: Story = {
  render: () => <Single options={make(2)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Pick/ }))
    await body().findByRole('option', { name: 'Option 01' })
    await expect(body().queryByPlaceholderText('Search…')).toBeNull()
  },
}
export const SearchForTwenty: Story = {
  render: () => <Single options={make(20)} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Pick/ }))
    await expect(await body().findByPlaceholderText('Search…')).toBeVisible()
  },
}
export const SearchForced: Story = {
  render: () => <Single options={make(2)} searchable />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Pick/ }))
    await expect(await body().findByPlaceholderText('Search…')).toBeVisible()
  },
}

/** A plain list: arrows and Enter choose, typing jumps to a label. */
export const PlainListKeyboard: Story = {
  render: () => <Single options={FRUIT} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Pick/ }))
    await body().findByRole('option', { name: 'Apple' })
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(canvas.getByRole('status', { name: 'Value' })).toHaveTextContent('banana')
    await userEvent.click(canvas.getByRole('button', { name: /Pick/ }))
    await body().findByRole('option', { name: 'Apple' })
    await userEvent.keyboard('ch')
    await waitFor(() =>
      expect(body().getByRole('option', { name: 'Cherry' })).toHaveAttribute(
        'data-selected',
        'true',
      ),
    )
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status', { name: 'Value' })).toHaveTextContent('cherry')
  },
}

/** Many choices: chips inside the field, the list stays open, a pick toggles, × clears all. */
export const MultiSelect: Story = {
  render: () => <Multi options={FRUIT} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: /Tags/ })
    await expect(trigger).toHaveTextContent('Any tag…')
    await userEvent.click(trigger)
    await userEvent.click(await body().findByRole('option', { name: 'Apple' }))
    await userEvent.click(body().getByRole('option', { name: 'Cherry' }))
    // Still open, selected options stay in place.
    await expect(body().getByRole('option', { name: 'Apple' })).toBeVisible()
    await expect(canvas.getByRole('status', { name: 'Values' })).toHaveTextContent('apple,cherry')
    await expect(trigger).not.toHaveTextContent('Any tag…')
    await userEvent.click(body().getByRole('option', { name: 'Apple' }))
    await expect(canvas.getByRole('status', { name: 'Values' })).toHaveTextContent(/^cherry$/)
    await userEvent.keyboard('{Escape}')
    await userEvent.click(canvas.getByRole('button', { name: 'Clear tags' }))
    await expect(trigger).toHaveTextContent('Any tag…')
  },
}
export const MultiSelectDark: Story = { ...MultiSelect, parameters: { dark: true } }

/** Chips that do not fit show the first ones and a "+N" counter, on one line at the usual field height. */
export const MultiOverflow: Story = {
  render: () => <Multi options={make(8)} initial={['v1', 'v2', 'v3', 'v4', 'v5', 'v6']} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: /Tags/ })
    await waitFor(() => expect(trigger).toHaveTextContent(/\+\d/))
    await expect(Math.round(trigger.getBoundingClientRect().height)).toBe(36)
    const field = trigger.getBoundingClientRect()
    const clear = canvas.getByRole('button', { name: 'Clear tags' }).getBoundingClientRect()
    const chevron = trigger.querySelector('svg')?.getBoundingClientRect()
    await expect(clear.right).toBeLessThanOrEqual((chevron?.left ?? 0) + 1)
    await expect(clear.left).toBeGreaterThan(field.left)
  },
}

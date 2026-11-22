import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ListFilters, sinceOptions } from '@/components/data/list-filters'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import { oneValue, type QueryField } from '@/lib/list-query'

type Params = {
  search: string
  units: string[]
  vat: string[]
  min: string | null
  max: string | null
  from: string | null
  to: string | null
  updated: string | null
  name: string
}

const NONE: Params = {
  search: '',
  units: [],
  vat: [],
  min: null,
  max: null,
  from: null,
  to: null,
  updated: null,
  name: '',
}

const fields: QueryField<Params>[] = [
  {
    id: 'unit',
    label: 'Unit',
    type: 'enum',
    values: [
      { value: 'hour', label: 'Hour' },
      { value: 'day', label: 'Day' },
    ],
    placeholder: 'Any unit…',
    get: (params) => params.units,
    set: (units) => ({ units }),
  },
  {
    id: 'vat',
    label: 'VAT',
    type: 'enum',
    values: ['8.1', '2.6'].map((rate) => ({ value: rate, label: `${rate}%` })),
    placeholder: 'Any VAT rate…',
    get: (params) => params.vat,
    set: (vat) => ({ vat }),
  },
  {
    id: 'from',
    label: 'Issued from',
    type: 'date',
    placeholder: 'Any issue date…',
    until: 'to',
    ...oneValue(
      (params) => params.from,
      (from) => ({ from }),
    ),
  },
  {
    id: 'to',
    label: 'Issued until',
    type: 'date',
    ...oneValue(
      (params) => params.to,
      (to) => ({ to }),
    ),
  },
  {
    id: 'min',
    label: 'Min. price',
    type: 'number',
    placeholder: 'Min. price',
    until: 'max',
    ...oneValue(
      (params) => params.min,
      (min) => ({ min }),
    ),
  },
  {
    id: 'max',
    label: 'Max. price',
    type: 'number',
    ...oneValue(
      (params) => params.max,
      (max) => ({ max }),
    ),
  },
  {
    id: 'updated',
    label: 'Updated',
    type: 'enum',
    values: sinceOptions(),
    placeholder: 'Updated any time…',
    ...oneValue(
      (params) => params.updated,
      (updated) => ({ updated }),
    ),
  },
  // Text the search covers: a chip, but no control in the popover.
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    ...oneValue(
      (params) => params.name || null,
      (name) => ({ name: name ?? '' }),
    ),
  },
]

/** A list's toolbar as the pages wire it: the popover and the search's chips share one state. */
function Harness({ initial = NONE }: { initial?: Params }) {
  const [params, setParams] = useState<Params>(initial)
  const update = (change: Partial<Params>) => setParams((current) => ({ ...current, ...change }))
  return (
    <div className="max-w-3xl rounded-xl border">
      <ListToolbar>
        <ListFilters fields={fields} params={params} onChange={update} />
        <ListSearch
          label="Search items"
          placeholder="Search or filter, e.g. unit:hour"
          value={params.search}
          onChange={(search) => update({ search })}
          query={{ fields, params, onChange: update }}
        />
      </ListToolbar>
      <output aria-label="Params" className="block p-3 font-mono text-xs">
        {JSON.stringify(params)}
      </output>
    </div>
  )
}

const meta = {
  title: 'Data/List filters',
  render: () => <Harness />,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const state = (canvas: ReturnType<typeof within>): unknown =>
  JSON.parse(canvas.getByRole('status', { name: 'Params' }).textContent ?? '{}')

const body = () => within(document.body)
const openFilters = (canvas: ReturnType<typeof within>) =>
  userEvent.click(canvas.getByRole('button', { name: /^Filters/ }))
const pick = async (control: RegExp, option: string) => {
  await userEvent.click(await body().findByRole('button', { name: control }))
  await userEvent.click(await body().findByRole('option', { name: option }))
}

/** No label rows: each control is named by its placeholder, and text fields have no control. */
export const Compact: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openFilters(canvas)
    const dialog = await body().findByRole('dialog')
    await expect(within(dialog).queryByRole('group')).toBeNull()
    await expect(within(dialog).getByRole('button', { name: /^Unit/ })).toHaveTextContent(
      'Any unit…',
    )
    await expect(within(dialog).getByRole('textbox', { name: 'Min. price' })).toHaveAttribute(
      'placeholder',
      'Min. price',
    )
    await expect(within(dialog).queryByRole('button', { name: /^Name/ })).toBeNull()
    // Nothing set yet: nothing to clear.
    await expect(within(dialog).queryByRole('button', { name: 'Clear all' })).toBeNull()
  },
}
export const CompactDark: Story = { ...Compact, parameters: { dark: true } }
export const CompactPhone: Story = { ...Compact, globals: { viewport: { value: 'phone' } } }

/** A choice in the popover is a chip in the search, and a typed term is a choice in the popover. */
export const SyncWithChips: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openFilters(canvas)
    await pick(/^Unit/, 'Hour')
    await expect(canvas.getByRole('button', { name: 'Remove filter Unit: Hour' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Filters/ })).toHaveTextContent('1')
    await userEvent.keyboard('{Escape}')

    const search = canvas.getByRole('searchbox', { name: 'Search items' })
    await userEvent.type(search, 'vat:2.6 min:10 ')
    await expect(state(canvas)).toMatchObject({ units: ['hour'], vat: ['2.6'], min: '10' })
    await openFilters(canvas)
    const dialog = await body().findByRole('dialog')
    await expect(
      within(dialog).getByRole('button', { name: 'Remove filter VAT: 2.6%' }),
    ).toBeVisible()
    await expect(within(dialog).getByRole('textbox', { name: 'Min. price' })).toHaveValue('10')

    // Removing the chip in the popover removes it from the search too.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove filter Unit: Hour' }))
    await expect(canvas.queryByRole('button', { name: 'Remove filter Unit: Hour' })).toBeNull()
  },
}

/** An amount applies on Enter or on leaving the field; one the API would refuse is undone. */
export const Amounts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openFilters(canvas)
    const max = await body().findByRole('textbox', { name: 'Max. price' })
    await userEvent.type(max, "1'200,5{Enter}")
    await expect(state(canvas)).toMatchObject({ max: '1200.5' })
    await expect(
      canvas.getByRole('button', { name: 'Remove filter Max. price: 1200.5' }),
    ).toBeVisible()
    const min = body().getByRole('textbox', { name: 'Min. price' })
    await userEvent.type(min, '-3')
    await userEvent.tab()
    await expect(min).toHaveValue('')
    await expect(state(canvas)).toMatchObject({ min: null })
  },
}

/** A date range: a preset, or two dates of one's own after "Custom range". */
export const DateRange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openFilters(canvas)
    await pick(/^Any issue date/, 'Last month')
    await waitFor(() => expect(state(canvas)).toMatchObject({ from: expect.any(String) }))
    await expect(body().queryByLabelText('Issued from')).toBeNull()
    await expect(canvas.getByRole('button', { name: /^Remove filter Issued from/ })).toBeVisible()

    await pick(/^Any issue date/, 'Custom range')
    const from = await body().findByLabelText('Issued from')
    await userEvent.clear(from)
    await userEvent.type(from, '2026-01-01')
    await expect(state(canvas)).toMatchObject({ from: '2026-01-01' })
  },
}

/** "Clear all" resets every control the popover has, and only those: the free text stays. */
export const ClearAll: Story = {
  render: () => (
    <Harness
      initial={{
        ...NONE,
        search: 'web',
        units: ['day'],
        min: '5',
        from: '2026-01-01',
        to: '2026-01-31',
        updated: '30d',
        name: 'acme',
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^Filters/ })).toHaveTextContent('4')
    await openFilters(canvas)
    await expect(await body().findByLabelText('Issued from')).toHaveValue('2026-01-01')
    await expect(body().getByRole('button', { name: /^Updated/ })).toHaveTextContent('Last 30 days')
    await userEvent.click(body().getByRole('button', { name: 'Clear all' }))
    await expect(state(canvas)).toEqual({ ...NONE, search: 'web', name: 'acme' })
    await expect(body().queryByRole('button', { name: 'Clear all' })).toBeNull()
  },
}

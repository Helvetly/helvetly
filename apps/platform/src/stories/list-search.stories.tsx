import { Checkbox } from '@helvetly/ui/components/checkbox'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import { oneValue, type QueryField } from '@/lib/list-query'

type Params = { search: string; type: string | null; tags: string[]; city: string }

const fields: QueryField<Params>[] = [
  {
    id: 'type',
    label: 'Type',
    type: 'enum',
    values: [
      { value: 'company', label: 'Companies' },
      { value: 'person', label: 'People' },
    ],
    ...oneValue(
      (params) => params.type,
      (type) => ({ type }),
    ),
  },
  {
    id: 'tag',
    label: 'Tags',
    type: 'tag',
    values: [
      { value: 'design', label: 'design' },
      { value: 'super', label: 'super' },
    ],
    get: (params) => params.tags,
    set: (tags) => ({ tags }),
  },
  {
    id: 'city',
    label: 'City',
    type: 'text',
    ...oneValue(
      (params) => params.city,
      (city) => ({ city: city ?? '' }),
    ),
  },
]

/** A list's toolbar as the pages wire it: the params are the one state of chips and filters. */
function Harness({ collapsible = false }: { collapsible?: boolean }) {
  const [params, setParams] = useState<Params>({ search: '', type: null, tags: [], city: '' })
  const update = (change: Partial<Params>) => setParams((current) => ({ ...current, ...change }))
  return (
    <div className="max-w-3xl rounded-xl border">
      <ListToolbar>
        <fieldset className="flex gap-3 px-2 text-sm">
          <legend className="sr-only">Filters</legend>
          {(['company', 'person'] as const).map((type) => (
            <label key={type} className="flex items-center gap-1.5">
              <Checkbox
                checked={params.type === type}
                onCheckedChange={(on) => update({ type: on ? type : null })}
              />
              {type === 'company' ? 'Companies' : 'People'}
            </label>
          ))}
        </fieldset>
        <ListSearch
          label="Search clients"
          placeholder="Search or filter, e.g. type:person"
          value={params.search}
          onChange={(search) => update({ search })}
          query={{ fields, params, onChange: update }}
          collapsible={collapsible}
        />
      </ListToolbar>
      <output aria-label="Params" className="block p-3 font-mono text-xs">
        {JSON.stringify(params)}
      </output>
    </div>
  )
}

const meta = {
  title: 'Data/List search',
  render: () => <Harness />,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const state = (canvas: ReturnType<typeof within>) => {
  const params: unknown = JSON.parse(
    canvas.getByRole('status', { name: 'Params' }).textContent ?? '{}',
  )
  return params
}

/** Suggestions for the field, then its values; Enter and Tab take the highlighted one. */
export const Suggestions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const search = canvas.getByRole('searchbox', { name: 'Search clients' })
    await userEvent.type(search, 't')
    const list = canvas.getByRole('listbox', { name: 'Search suggestions' })
    // "t" starts both Type and Tags; arrows move through them.
    await expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Typetype:', 'Tagstag:'])
    await userEvent.keyboard('{ArrowDown}{Tab}')
    await expect(search).toHaveValue('tag:')
    await expect(within(list).getAllByRole('option')).toHaveLength(2)
    await userEvent.type(search, 'su')
    await expect(within(list).getByRole('option', { selected: true })).toHaveTextContent(
      'Tags:super',
    )
    await userEvent.keyboard('{Enter}')
    await expect(search).toHaveValue('')
    await expect(canvas.getByRole('button', { name: 'Remove filter Tags: super' })).toBeVisible()
    await expect(state(canvas)).toMatchObject({ tags: ['super'], search: '' })
    // A free-text field suggests just what was typed; Escape closes the list.
    await userEvent.type(search, 'city:Zü')
    await expect(within(list).getByRole('option')).toHaveTextContent('City:Zü')
    await userEvent.keyboard('{Escape}')
    await expect(list).not.toBeVisible()
    await expect(search).toHaveValue('city:Zü')
  },
}

/** Typing: terms become chips at a space or Enter, text stays free text, chips edit and remove. */
export const Chips: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const search = canvas.getByRole('searchbox', { name: 'Search clients' })
    await userEvent.type(search, 'acme type:people city:"St. Gallen" foo:bar{Enter}')
    await expect(search).toHaveValue('acme foo:bar')
    await expect(state(canvas)).toEqual({
      search: 'acme foo:bar',
      type: 'person',
      tags: [],
      city: 'St. Gallen',
    })
    await expect(canvas.getByRole('button', { name: 'Remove filter Type: People' })).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Remove filter City: St. Gallen' }),
    ).toBeVisible()

    // A new term for a one-value field replaces the old chip.
    await userEvent.type(search, ' type:company ')
    await expect(canvas.queryByRole('button', { name: 'Remove filter Type: People' })).toBeNull()
    await expect(state(canvas)).toMatchObject({ type: 'company' })

    // Backspace in an empty field removes the last chip; × removes any one.
    await userEvent.clear(search)
    await userEvent.keyboard('{Backspace}')
    await expect(state(canvas)).toMatchObject({ type: 'company', city: '', search: '' })
    await userEvent.click(canvas.getByRole('button', { name: 'Remove filter Type: Companies' }))
    await expect(state(canvas)).toMatchObject({ type: null })

    // A click on a chip puts its term back into the field to edit.
    await userEvent.type(search, 'city:Bern ')
    await userEvent.click(canvas.getByRole('button', { name: 'Edit filter City: Bern' }))
    await expect(search).toHaveValue('city:Bern')
    await expect(search).toHaveFocus()
    await expect(state(canvas)).toMatchObject({ city: '' })
    await userEvent.type(search, 'er{Enter}')
    await expect(state(canvas)).toMatchObject({ city: 'Berner' })

    // The × at the end clears text and chips together.
    await userEvent.type(search, 'x')
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }))
    await expect(state(canvas)).toEqual({ search: '', type: null, tags: [], city: '' })
  },
}

/** The filters outside the search and its chips are one state: each shows the other's changes. */
export const SyncsWithFilters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Companies' }))
    await expect(
      canvas.getByRole('button', { name: 'Remove filter Type: Companies' }),
    ).toBeVisible()
    await userEvent.type(canvas.getByRole('searchbox'), 'type:person ')
    await expect(canvas.getByRole('checkbox', { name: 'People' })).toBeChecked()
    await expect(canvas.getByRole('checkbox', { name: 'Companies' })).not.toBeChecked()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove filter Type: People' }))
    await expect(canvas.getByRole('checkbox', { name: 'People' })).not.toBeChecked()
  },
}

/** The Documents page's folded search opens on a click and stays open while it holds chips. */
export const Collapsible: Story = {
  render: () => <Harness collapsible />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Search clients' }))
    const search = canvas.getByRole('searchbox', { name: 'Search clients' })
    await expect(search).toHaveFocus()
    await userEvent.type(search, 'tag:design ')
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Remove filter Tags: design' })).toBeVisible()
    await expect(canvas.getByRole('searchbox', { name: 'Search clients' })).toBeVisible()
  },
}

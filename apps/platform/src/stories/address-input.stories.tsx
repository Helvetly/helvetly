import { inputClass } from '@helvetly/ui/components/input'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AddressInput } from '@/components/scheduling/address-input'
import type { Address } from '@/lib/addresses'

import { sessionHandler } from './screen-fixtures'

const searched = fn()

const zurich: Address = {
  label: 'Bahnhofstrasse 1, 8001 Zürich',
  street: 'Bahnhofstrasse',
  house_number: '1',
  postcode: '8001',
  city: 'Zürich',
  country: 'CH',
  lat: 47.3769,
  lon: 8.5417,
}
const konstanz: Address = {
  label: 'Bahnhofstrasse 1, 78462 Konstanz, Germany',
  street: 'Bahnhofstrasse',
  house_number: '1',
  postcode: '78462',
  city: 'Konstanz',
  country: 'DE',
  lat: 47.659,
  lon: 9.175,
}

const suggestions = http.get('/api/v1/addresses/suggest', async ({ request }) => {
  const params = new URL(request.url).searchParams
  searched(Object.fromEntries(params))
  await delay(60)
  const q = params.get('q')?.toLowerCase() ?? ''
  return HttpResponse.json({ data: q.startsWith('bahnhof') ? [zurich, konstanz] : [] })
})

function LocationField({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="grid max-w-md gap-1.5 p-6">
      <label htmlFor="location" className="text-body-sm font-medium">
        Location
      </label>
      <AddressInput
        id="location"
        value={value}
        onChange={setValue}
        placeholder="Address or room"
        className={inputClass}
      />
      <output data-testid="value">{value}</output>
    </div>
  )
}

const meta = {
  title: 'Scheduling/Address input',
  component: LocationField,
  parameters: { msw: { handlers: [sessionHandler(), suggestions] } },
} satisfies Meta<typeof LocationField>
export default meta
type Story = StoryObj<typeof meta>

export const PickASuggestion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const field = canvas.getByLabelText('Location')
    await userEvent.type(field, 'Bahnhof')
    const list = await canvas.findByRole('list', { name: 'Address suggestions' })
    await waitFor(() =>
      expect(searched).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'Bahnhof', country: 'CH', lang: 'en' }),
      ),
    )
    // Same country: no country on the second line; another one names it.
    await expect(within(list).getByText('8001 Zürich')).toBeVisible()
    await expect(within(list).getByText('78462 Konstanz · DE')).toBeVisible()
    await expect(canvas.getByText('© OpenStreetMap contributors')).toBeVisible()

    await userEvent.keyboard('{ArrowDown}')
    await expect(within(list).getAllByRole('button')[0]).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByTestId('value')).toHaveTextContent('Bahnhofstrasse 1, 8001 Zürich')
    await expect(canvas.queryByRole('list')).not.toBeInTheDocument()
    await expect(field).toHaveFocus()
    await expect(canvas.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/search?query=Bahnhofstrasse%201%2C%208001%20Z%C3%BCrich',
    )
  },
}

export const FreeTextKept: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const field = canvas.getByLabelText('Location')
    await userEvent.type(field, 'Room 3, 2nd floor')
    await waitFor(() =>
      expect(searched).toHaveBeenCalledWith(expect.objectContaining({ q: 'Room 3, 2nd floor' })),
    )
    await expect(canvas.queryByRole('list')).not.toBeInTheDocument()
    await expect(canvas.getByTestId('value')).toHaveTextContent('Room 3, 2nd floor')

    // Escape closes an open list and keeps what was typed.
    await userEvent.clear(field)
    await userEvent.type(field, 'Bahnhof')
    await canvas.findByRole('list', { name: 'Address suggestions' })
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('list')).not.toBeInTheDocument()
    await expect(field).toHaveValue('Bahnhof')
  },
}

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('link', { name: 'Open in Maps' })).not.toBeInTheDocument()
    await userEvent.type(canvas.getByLabelText('Location'), 'Ba')
    await expect(canvas.queryByRole('list')).not.toBeInTheDocument()
  },
}

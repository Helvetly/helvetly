import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientForm } from '@/components/clients/client-form'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Clients/Client form',
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/clients/tags', () => HttpResponse.json({ data: [] })),
      ],
    },
  },
  render: () => <ClientForm onClose={fn()} onSaved={fn()} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const radio = (name: string) => body().getByRole('radio', { name })

/** Company or person is the first choice of Basics, as two cards that say what each means. */
export const ClientType: Story = {
  play: async () => {
    const type = await body().findByRole('radiogroup', { name: 'Client type' })
    await expect(type).toBeVisible()
    await expect(radio('Company')).toBeChecked()
    await expect(body().getByRole('textbox', { name: 'Company name' })).toBeVisible()

    await userEvent.click(within(type).getByText('A private individual, by first and last name'))
    await expect(radio('Person')).toBeChecked()
    await expect(body().getByRole('textbox', { name: 'Full name' })).toBeVisible()
    await expect(body().queryByRole('textbox', { name: 'Company name' })).toBeNull()
  },
}

/** Native radios: Tab reaches the chosen card, the arrow keys move the choice, and the focus ring moves nothing. */
export const Keyboard: Story = {
  play: async () => {
    const type = await body().findByRole('radiogroup', { name: 'Client type' })
    const before = type.getBoundingClientRect()
    radio('Company').focus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(radio('Person')).toBeChecked())
    await expect(radio('Person')).toHaveFocus()
    await expect(body().getByRole('textbox', { name: 'Full name' })).toBeVisible()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(radio('Company')).toBeChecked())
    const after = type.getBoundingClientRect()
    await expect([after.top, after.height]).toEqual([before.top, before.height])
  },
}

/** Editing keeps the same choice: a client saved as a person opens with Person chosen and can change. */
export const EditPerson: Story = {
  render: () => (
    <ClientForm
      client={sampleClient({ name: 'Anna Muster', is_company: false })}
      onClose={fn()}
      onSaved={fn()}
    />
  ),
  play: async () => {
    await waitFor(() => expect(radio('Person')).toBeChecked())
    await expect(body().getByRole('textbox', { name: 'Full name' })).toHaveValue('Anna Muster')
    await userEvent.click(radio('Company'))
    await expect(body().getByRole('textbox', { name: 'Company name' })).toHaveValue('Anna Muster')
  },
}

export const Phone: Story = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '360px', height: '780px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async () => {
    const type = await body().findByRole('radiogroup', { name: 'Client type' })
    await userEvent.click(radio('Person'))
    await expect(radio('Person')).toBeChecked()
    await expect(type.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

export const Dark: Story = {
  parameters: { dark: true },
  play: ClientType.play,
}

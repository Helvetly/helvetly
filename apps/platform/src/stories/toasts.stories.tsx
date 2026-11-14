import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { expect, waitFor, within } from 'storybook/test'

function Toasts() {
  // Fixed ids: StrictMode runs the effect twice.
  useEffect(() => {
    toast.success('John saved.', { id: 'saved' })
    toast.error('The invoice could not be sent.', {
      id: 'error',
      description: 'Check the client’s email.',
    })
    toast.info('Heidi is drafting your reminder.', { id: 'info' })
    toast('Client deleted.', { id: 'undo', action: { label: 'Undo', onClick: () => {} } })
  }, [])
  return <Toaster position="bottom-right" expand />
}

const meta = {
  title: 'Design system/Toasts',
  render: () => <Toasts />,
  parameters: { ownMain: true },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Inverted against the page, so a toast never blends into white cards and sheets. */
const standsOut = async () => {
  const body = within(document.body)
  const saved = await body.findByText('John saved.')
  const item = saved.closest('[data-sonner-toast]')
  if (!(item instanceof HTMLElement)) throw new Error('No toast around “John saved.”')
  await waitFor(() =>
    expect(getComputedStyle(item).backgroundColor).not.toBe(
      getComputedStyle(document.body).backgroundColor,
    ),
  )
  await waitFor(() => expect(body.getByRole('button', { name: 'Undo' })).toBeVisible())
}

export const Light: Story = { play: standsOut }
export const Dark: Story = { parameters: { dark: true }, play: standsOut }

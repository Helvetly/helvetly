import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import PageError from '@/app/(app)/error'

const error = Object.assign(new Error("Cannot read properties of undefined (reading 'map')"), {
  digest: '2918403711',
})

const meta = {
  title: 'Shell/Error page',
  component: PageError,
  args: { error, reset: fn() },
  // The page keeps the app's top bar, which lives in the sidebar layout.
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="flex min-w-0 flex-1 flex-col [&>header~*]:bg-card">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: { ownMain: true },
} satisfies Meta<typeof PageError>
export default meta
type Story = StoryObj<typeof meta>

const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}

/** A calm tile and a human title; "Try again" re-renders the page through Next's reset. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Something went wrong on this page' }),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/')
    await expect(canvas.getByRole('button', { name: 'Go back' })).toBeVisible()
    await expect(canvas.queryByText('Technical details')).toBeNull()
    await expect(canvas.queryByText('Report this problem')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(args.reset).toHaveBeenCalledOnce()
  },
}

export const Dark: Story = {
  parameters: { dark: true },
  play: Default.play,
}

/** On a 390px phone the buttons and the subtitle wrap and nothing pushes the page sideways. */
export const Phone: Story = {
  parameters: phone,
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('heading', { name: 'Something went wrong on this page' })
    await expect(window.innerWidth).toBe(390)
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

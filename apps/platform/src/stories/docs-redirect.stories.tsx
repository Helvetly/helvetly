import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, waitFor, within } from 'storybook/test'

import { API_REFERENCE_URL, DocsRedirect } from '@/components/developers/docs-redirect'

const navigate = fn()

const meta = {
  title: 'Developers/Docs redirect',
  component: DocsRedirect,
  args: { navigate },
  beforeEach: () => {
    navigate.mockClear()
  },
} satisfies Meta<typeof DocsRedirect>
export default meta
type Story = StoryObj<typeof meta>

/** /developers sends the reader to the docs site's API reference at once, with a link as the fallback. */
export const RedirectsToDocs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(API_REFERENCE_URL))
    await expect(navigate).toHaveBeenCalledTimes(1)
    await expect(API_REFERENCE_URL).toBe('https://docs.helvetly.com/api/reference')
    await expect(canvas.getByRole('link', { name: 'the Helvetly docs' })).toHaveAttribute(
      'href',
      API_REFERENCE_URL,
    )
    await expect(
      canvas.getByRole('status', { name: 'Opening the API reference' }),
    ).toBeInTheDocument()
  },
}

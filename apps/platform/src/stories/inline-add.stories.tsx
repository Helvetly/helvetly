import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { InlineAdd } from '@/components/inline-add'
import { ApiError } from '@/lib/api'

const meta = { title: 'Shared flows/Inline add' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const onOpenChange = fn()
const save = fn(async (text: string) => {
  if (text === 'taken')
    throw new ApiError(422, 'validation_failed', 'This internal ID is already used.')
})

/** In a real browser: Escape closes only the input inside a sheet; a refused value keeps focus and its reason. */
export const InASheet: Story = {
  render: () => (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetTitle>Client</SheetTitle>
        <SheetDescription>Internal details</SheetDescription>
        <div className="p-4">
          <InlineAdd label="Add internal ID" save={save} />
        </div>
      </SheetContent>
    </Sheet>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    onOpenChange.mockClear()
    save.mockClear()
    const open = async () => {
      await userEvent.click(page.getByRole('button', { name: 'Add internal ID' }))
      return page.getByRole('textbox', { name: 'Add internal ID' })
    }

    await userEvent.type(await open(), 'K-1{Escape}')
    await expect(page.getByRole('button', { name: 'Add internal ID' })).toBeVisible()
    await expect(onOpenChange).not.toHaveBeenCalled()

    const input = await open()
    await userEvent.type(input, 'taken{Enter}')
    await expect(await page.findByRole('alert')).toHaveTextContent('already used')
    await waitFor(() => expect(input).toHaveFocus())

    await userEvent.clear(input)
    await userEvent.type(input, 'K-1042{Enter}')
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('K-1042'))
    await expect(page.getByRole('button', { name: 'Add internal ID' })).toBeVisible()
    await expect(onOpenChange).not.toHaveBeenCalled()
  },
}

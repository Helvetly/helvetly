import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Sparkle } from 'lucide-react'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ShortcutKeys, WithShortcut } from '@/components/shortcuts/shortcut-keys'
import { ShortcutsDialog } from '@/components/shortcuts/shortcuts-dialog'
import { useShortcut } from '@/lib/shortcuts'

/** A page with a text field and a rich-text area; "?" opens the shortcuts dialog. */
function Host({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  useShortcut('shortcuts', () => setOpen(true))
  return (
    <div className="grid max-w-sm gap-3 p-4">
      <input aria-label="Note" className="h-9 rounded-md border px-2 text-body-sm" />
      <div
        data-testid="rich-note"
        contentEditable
        suppressContentEditableWarning
        className="min-h-9 rounded-md border px-2 py-1.5 text-body-sm"
      />
      <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
        Press <ShortcutKeys id="shortcuts" /> for every shortcut.
      </p>
      <ShortcutsDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}

const meta = {
  title: 'Keyboard shortcuts',
  component: Host,
} satisfies Meta<typeof Host>
export default meta
type Story = StoryObj<typeof meta>

const dialog = () => within(document.body).findByRole('dialog', { name: 'Keyboard shortcuts' })

/** The dialog: every shortcut grouped, ⌘ on a Mac and Ctrl elsewhere. */
export const Dialog: Story = {
  args: { initiallyOpen: true },
  play: async () => {
    const shown = within(await dialog())
    // Visible once the dialog's open animation has run.
    await waitFor(() => expect(shown.getByText('Open or close Heidi')).toBeVisible())
    await expect(shown.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'General',
      'Navigation',
      'Appearance',
      'On a page',
    ])
    await expect(shown.getByText('Go to Notifications')).toBeVisible()
    const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'
    // One keycap per step ("Ctrl K"), so the modifier is a word inside it.
    await expect(shown.getAllByText(new RegExp(`(^|\\s)${mod}(\\s|$)`)).length).toBeGreaterThan(0)
    await expect(shown.getByText('then')).toBeVisible()
  },
}

/** "?" opens it from the page, but not while typing in a field or in rich text; Escape closes it. */
export const OpensWithQuestionMark: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Note'), '?')
    await expect(canvas.getByLabelText('Note')).toHaveValue('?')
    await userEvent.click(canvas.getByTestId('rich-note'))
    await userEvent.keyboard('?')
    await expect(within(document.body).queryByRole('dialog')).toBeNull()

    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await userEvent.keyboard('?')
    await dialog()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  },
}

/** The hint in a tooltip: the label with its keycaps. */
export const TooltipHint: Story = {
  render: () => (
    <div className="p-4 pt-14">
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Ask Heidi">
            <Sparkle />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <WithShortcut label="Ask Heidi" id="heidi" />
        </TooltipContent>
      </Tooltip>
    </div>
  ),
  play: async () => {
    const tip = await within(document.body).findByRole('tooltip')
    await expect(tip).toHaveTextContent('Ask Heidi')
    await expect(tip).toHaveTextContent('J')
  },
}

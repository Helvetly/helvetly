import { Button } from '@helvetly/ui/components/button'
import { ThemeProvider } from '@helvetly/ui/components/theme-provider'
import { ThemeToggle } from '@helvetly/ui/components/theme-toggle'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { LogOut } from 'lucide-react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { PlanScreen } from '@/components/shell/plan-gate'

// Its own storage key, so a story never changes the theme Storybook itself remembers.
const STORAGE_KEY = 'story-theme'

const meta = {
  title: 'Theme toggle',
  component: ThemeToggle,
  decorators: [
    (Story, { parameters }) => {
      localStorage.removeItem(STORAGE_KEY)
      return (
        <ThemeProvider
          storageKey={STORAGE_KEY}
          hotkey={false}
          defaultTheme={parameters.dark ? 'dark' : 'system'}
        >
          <Story />
        </ThemeProvider>
      )
    },
  ],
} satisfies Meta<typeof ThemeToggle>
export default meta
type Story = StoryObj<typeof meta>

const html = document.documentElement

/** Light, Dark and System; the current one is raised, System until one is chosen. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true'),
    )

    await userEvent.hover(canvas.getByRole('radio', { name: 'Dark' }))
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('Dark')
    await userEvent.click(canvas.getByRole('radio', { name: 'Dark' }))
    await waitFor(() => expect(html).toHaveClass('dark'))
    await expect(canvas.getByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')

    await userEvent.click(canvas.getByRole('radio', { name: 'Light' }))
    await waitFor(() => expect(html).not.toHaveClass('dark'))
    await expect(canvas.getByRole('radio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // Back to System, so the next story starts from the page's own theme.
    await userEvent.click(canvas.getByRole('radio', { name: 'System' }))
    await expect(localStorage.getItem(STORAGE_KEY)).toBe('system')
  },
}

/** The plan picker's bar: the theme next to Sign out, the stored choice raised. */
export const InPlanPickerBar: Story = {
  parameters: { layout: 'fullscreen', ownMain: true },
  render: () => (
    <PlanScreen
      workspace={<span className="truncate text-[14px] font-semibold">Alpenglühn GmbH</span>}
      action={
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <LogOut className="size-3.5" /> Sign out
        </Button>
      }
    >
      <h1 className="text-display font-semibold">Choose a plan</h1>
    </PlanScreen>
  ),
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement.querySelector('header') ?? canvasElement)
    await expect(bar.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Sign out' })).toBeVisible()
  },
}

export const InPlanPickerBarDark: Story = {
  ...InPlanPickerBar,
  parameters: { ...InPlanPickerBar.parameters, dark: true },
  play: async (context) => {
    await InPlanPickerBar.play?.(context)
    await waitFor(() =>
      expect(within(context.canvasElement).getByRole('radio', { name: 'Dark' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
  },
}

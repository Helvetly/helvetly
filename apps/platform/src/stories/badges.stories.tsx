import { Badge, BADGE_TONES } from '@helvetly/ui/components/badge'
import { cn } from '@helvetly/ui/lib/utils'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { CircleCheck } from 'lucide-react'
import { expect, within } from 'storybook/test'

const meta = {
  title: 'Design system/Badges',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const style = (node: Element) => getComputedStyle(node)

const VARIANTS = ['soft', 'outline', 'solid', 'dot'] as const
const SIZES = ['md', 'sm'] as const

function Matrix({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <section
      aria-label={theme}
      className={cn('grid gap-4 rounded-xl bg-background p-5 text-foreground', theme)}
    >
      {SIZES.map((size) => (
        <div key={size} className="grid gap-2">
          {BADGE_TONES.map((tone) => (
            <div key={tone} className="flex flex-wrap items-center gap-2">
              {VARIANTS.map((variant) => (
                <Badge key={variant} variant={variant} tone={tone} size={size}>
                  {tone}
                </Badge>
              ))}
              <Badge tone={tone} size={size}>
                <CircleCheck aria-hidden />
                {tone}
              </Badge>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

/** Every variant × tone × size, with a leading icon and the dot, in both themes. */
export const AllBadges: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2">
      <Matrix theme="light" />
      <Matrix theme="dark" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const light = within(within(canvasElement).getByRole('region', { name: 'light' }))
    const dark = within(within(canvasElement).getByRole('region', { name: 'dark' }))
    const soft = (scope: typeof light, tone: string) =>
      scope.getAllByText(tone).find((node) => node.dataset.variant === 'soft')!
    // Each tone paints its own tint, and a theme its own ink: the CSS variables resolve.
    await expect(style(soft(light, 'green')).backgroundColor).not.toBe(
      style(soft(light, 'red')).backgroundColor,
    )
    await expect(style(soft(light, 'violet')).color).not.toBe(style(soft(dark, 'violet')).color)
    // The dot variant draws its coloured dot, hidden from screen readers.
    const dot = light.getAllByText('amber').find((node) => node.dataset.variant === 'dot')!
    await expect(dot.querySelector('[aria-hidden]')).toBeInTheDocument()
    await expect(style(dot).borderColor).toBe(
      style(light.getAllByText('blue').find((n) => n.dataset.variant === 'dot')!).borderColor,
    )
  },
}

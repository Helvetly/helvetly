import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { EmptyState } from '@/components/heidi/empty-state'

import { screenHandlers } from './screen-fixtures'

const handlers = [
  ...screenHandlers,
  http.get('/api/v1/heidi/suggestions', () =>
    HttpResponse.json({
      data: [
        { title: 'Overdue invoices', prompt: 'Which invoices are overdue?' },
        { title: 'This month', prompt: 'How much did I invoice this month?' },
      ],
    }),
  ),
]

const meta = {
  title: 'Heidi/Welcome',
  component: EmptyState,
  parameters: { msw: { handlers } },
  args: { page: 'dashboard', wide: false, onPick: fn() },
  render: (args) => (
    <div className="@container/heidi flex h-[600px] w-[420px] flex-col border bg-background px-4">
      <EmptyState {...args} />
    </div>
  ),
} satisfies Meta<typeof EmptyState>
export default meta
type Story = StoryObj<typeof meta>

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
/** The letters typed so far: the visible text, without the laid-out but hidden rest. */
const typedText = (heading: HTMLElement) =>
  [...heading.querySelectorAll('span:not(.invisible)')]
    .filter((span) => span.children.length === 0)
    .map((span) => span.textContent)
    .join('')

/** A new chat greets by name in large type, typed letter by letter, with a subtitle of at most two lines. */
export const NewChat: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const heading = await canvas.findByRole('heading', { level: 2 })
    await waitFor(() => expect(heading).toHaveAccessibleName(/, Anna\. What’s on your mind\?/))
    expect(parseFloat(getComputedStyle(heading).fontSize)).toBeGreaterThanOrEqual(22)
    const full = heading.textContent ?? ''
    const height = heading.getBoundingClientRect().height

    // Typed behind a caret, the full text laid out from the start so nothing moves; the caret fades at the end.
    if (!reducedMotion()) expect(typedText(heading).length).toBeLessThan(full.length)
    await waitFor(() => expect(typedText(heading)).toBe(full), { timeout: 4000 })
    expect(heading.getBoundingClientRect().height).toBe(height)
    const caret = heading.querySelector('[data-caret] span')
    if (caret && !reducedMotion()) {
      await waitFor(() => expect(getComputedStyle(caret).opacity).toBe('0'), { timeout: 3000 })
    }

    const subtitle = canvas.getByText(/^Ask about invoices/)
    const lineHeight = parseFloat(getComputedStyle(subtitle).lineHeight)
    expect(subtitle.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight * 2 + 1)
    expect(subtitle.scrollHeight).toBeLessThanOrEqual(subtitle.clientHeight) // nothing clamped away

    await userEvent.click(await canvas.findByRole('button', { name: /Which invoices are overdue/ }))
    await expect(args.onPick).toHaveBeenCalledWith('Which invoices are overdue?')
  },
}

export const NewChatDark: Story = { ...NewChat, parameters: { ...NewChat.parameters, dark: true } }

/** At phone width the greeting still fits and the subtitle keeps to two lines. */
export const NewChatPhone: Story = {
  ...NewChat,
  render: (args) => (
    <div className="@container/heidi flex h-[600px] w-[340px] flex-col border bg-background px-4">
      <EmptyState {...args} />
    </div>
  ),
}

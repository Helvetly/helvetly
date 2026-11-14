import { Button } from '@helvetly/ui/components/button'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { HeidiPanel } from '@/components/heidi/heidi-panel'
import { HeidiProvider, useHeidi } from '@/components/heidi/heidi-provider'

import { screenHandlers } from './screen-fixtures'

const scope = 'storybook:quote'
const answer = 'Two invoices are overdue.\\n\\nTogether they come to CHF 1,200.'

const meta = {
  title: 'Heidi/Quote a selection',
  parameters: {
    msw: {
      handlers: [
        ...screenHandlers,
        http.get('/api/v1/heidi/usage', () =>
          HttpResponse.json({
            period: '2026-11',
            tokens_used: 0,
            tokens_included: 0,
            tokens_purchased: 0,
            tokens_remaining: 0,
            mode: 'local',
            usage_uncertain: false,
            can_purchase: false,
          }),
        ),
        http.get('/api/v1/heidi/suggestions', () =>
          HttpResponse.json({
            data: [{ title: 'Overdue invoices', prompt: 'Which invoices are overdue?' }],
          }),
        ),
        http.post(
          '/api/v1/heidi/chat',
          () =>
            new HttpResponse(
              `data: {"type":"text","value":"${answer}"}\n\ndata: {"type":"done","usage":{"tokens":0}}\n\n`,
              { headers: { 'Content-Type': 'text/event-stream' } },
            ),
        ),
      ],
    },
  },
  beforeEach: () => {
    localStorage.removeItem('helvetly:heidi:panel')
    localStorage.removeItem(`helvetly:heidi:conversation:${scope}`)
    document.getSelection()?.removeAllRanges()
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Open() {
  const heidi = useHeidi()
  return <Button onClick={() => heidi?.setOpen(true)}>Open assistant</Button>
}

function Panel() {
  return (
    <HeidiProvider scope={scope}>
      <Open />
      <HeidiPanel />
    </HeidiProvider>
  )
}

/** Asks the question and selects the whole two-paragraph answer. */
async function selectAnswer(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: 'Open assistant' }))
  await userEvent.click(await canvas.findByRole('button', { name: 'Which invoices are overdue?' }))
  const log = await canvas.findByRole('log', { name: 'Conversation' })
  const first = await within(log).findByText('Two invoices are overdue.')
  const last = within(log).getByText('Together they come to CHF 1,200.')
  await waitFor(() => expect(first.closest('[data-answer]')).not.toBeNull())
  const range = document.createRange()
  range.setStartBefore(first)
  range.setEndAfter(last)
  document.getSelection()?.removeAllRanges()
  document.getSelection()?.addRange(range)
  return { canvas, log }
}

/** A multi-line selection is quoted line by line and sent as a Markdown quote ahead of the question. */
export const QuoteMultipleLines: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const { canvas, log } = await selectAnswer(canvasElement)
    const menu = await canvas.findByRole('toolbar', { name: 'Selected text' })
    await userEvent.click(within(menu).getByRole('button', { name: 'Quote' }))
    await expect(canvas.queryByRole('toolbar')).not.toBeInTheDocument()

    const chip = canvas.getByText('Replying to').parentElement?.parentElement
    await expect(chip).toHaveTextContent(
      'Two invoices are overdue. Together they come to CHF 1,200.',
    )
    const box = canvas.getByRole('textbox', { name: 'Message Heidi' })
    await expect(box).toHaveFocus()
    await userEvent.type(box, 'Remind both clients{Enter}')

    const quote = await within(log).findByRole('blockquote')
    await expect(quote).toHaveTextContent('Two invoices are overdue.')
    await expect(quote).toHaveTextContent('Together they come to CHF 1,200.')
    await expect(within(log).getByText('Remind both clients')).toBeVisible()
  },
}

/** Shift+F10 reaches the menu from the keyboard; Escape closes only the menu, not the panel. */
export const KeyboardAndEscape: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const { canvas } = await selectAnswer(canvasElement)
    const menu = within(await canvas.findByRole('toolbar', { name: 'Selected text' }))
    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    await expect(menu.getByRole('button', { name: 'Quote' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(menu.getByRole('button', { name: 'Copy' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('toolbar')).not.toBeInTheDocument()
    await expect(canvas.getByRole('log', { name: 'Conversation' })).toBeVisible()
  },
}

/** A click outside the menu closes it, and the quote chip can be removed again. */
export const ClickOutsideAndRemove: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const { canvas } = await selectAnswer(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Quote' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Remove quote' }))
    await expect(canvas.queryByText('Replying to')).not.toBeInTheDocument()

    await selectAnswer(canvasElement).catch(() => undefined)
    const range = document.createRange()
    range.selectNodeContents(canvas.getByText('Two invoices are overdue.'))
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
    await canvas.findByRole('toolbar', { name: 'Selected text' })
    await userEvent.click(canvas.getByRole('textbox', { name: 'Message Heidi' }))
    await waitFor(() => expect(canvas.queryByRole('toolbar')).not.toBeInTheDocument())
  },
}

/** The menu in dark mode. */
export const MenuDark: Story = {
  render: () => <Panel />,
  parameters: { dark: true },
  play: async ({ canvasElement }) => {
    const { canvas } = await selectAnswer(canvasElement)
    const menu = await canvas.findByRole('toolbar', { name: 'Selected text' })
    // The menu fades in from opacity 0.
    await waitFor(() => expect(menu).toBeVisible())
  },
}

/** A right-click as the browser sends it; user-event's would collapse the selection first. */
function rightClick(target: Element) {
  const { left, top } = target.getBoundingClientRect()
  const at = { bubbles: true, cancelable: true, button: 2, clientX: left + 4, clientY: top + 4 }
  target.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse' }))
  target.dispatchEvent(new MouseEvent('contextmenu', at))
}

/** Right-clicking a selection in an answer opens the app's menu; "Quote in reply" is the same quote. */
export const RightClickQuote: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const { canvas, log } = await selectAnswer(canvasElement)
    const first = within(log).getByText('Two invoices are overdue.')
    rightClick(first)
    const page = within(document.body)
    const menu = await page.findByRole('menu', { name: 'Message' })
    // The menu fades in from opacity 0.
    await waitFor(() =>
      expect(within(menu).getByText('Shift + right-click for the browser’s menu')).toBeVisible(),
    )
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Quote in reply', 'Copy', 'Copy message'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Quote in reply' }))

    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument())
    const chip = canvas.getByText('Replying to').parentElement?.parentElement
    await expect(chip).toHaveTextContent(
      'Two invoices are overdue. Together they come to CHF 1,200.',
    )
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Message Heidi' })).toHaveFocus(),
    )
    // The chip is inset by the same 8px on top as on the sides.
    const form = chip?.closest('form')?.getBoundingClientRect()
    const box = chip?.getBoundingClientRect()
    await expect(Math.round((box?.top ?? 0) - (form?.top ?? 0))).toBe(8)
    await expect(Math.round((box?.left ?? 0) - (form?.left ?? 0))).toBe(8)
  },
}

/** The user's own message has the menu too; Shift keeps the browser's menu (Look Up, Translate). */
export const RightClickOwnMessageAndShift: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const { log } = await selectAnswer(canvasElement)
    document.getSelection()?.removeAllRanges()
    const question = within(log).getByText('Which invoices are overdue?')
    await userEvent.pointer({ keys: '[MouseRight]', target: question })
    const page = within(document.body)
    const menu = await page.findByRole('menu', { name: 'Message' })
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Copy message'])
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument())

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true })
    question.dispatchEvent(event)
    await expect(event.defaultPrevented).toBe(false)
    await expect(page.queryByRole('menu')).not.toBeInTheDocument()
  },
}

/** The right-click menu in dark mode. */
export const RightClickDark: Story = {
  render: () => <Panel />,
  parameters: { dark: true },
  play: async ({ canvasElement }) => {
    const { log } = await selectAnswer(canvasElement)
    rightClick(within(log).getByText('Together they come to CHF 1,200.'))
    const menu = await within(document.body).findByRole('menu', { name: 'Message' })
    await waitFor(() => expect(menu).toBeVisible())
  },
}

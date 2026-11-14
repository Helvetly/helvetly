import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MessageMenu } from './message-menu'

function Harness({
  onQuote = vi.fn<(quote: string) => void>(),
  markdown,
}: {
  onQuote?: (quote: string) => void
  markdown?: string
}) {
  return (
    <>
      <p>Outside the message</p>
      <MessageMenu plain={() => 'Two invoices are overdue.'} markdown={markdown} onQuote={onQuote}>
        <div data-testid="message">
          <p>Two invoices are overdue.</p>
          <p>Total CHF 1,200.</p>
        </div>
      </MessageMenu>
    </>
  )
}

function select(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  document.getSelection()?.removeAllRanges()
  document.getSelection()?.addRange(range)
}

const message = () => screen.getByTestId('message')
const items = () => screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())

afterEach(() => document.getSelection()?.removeAllRanges())

test('with a selection inside the message it offers quoting and copying it', async () => {
  const onQuote = vi.fn<(quote: string) => void>()
  render(<Harness onQuote={onQuote} />)
  select(screen.getByText('Total CHF 1,200.'))
  fireEvent.contextMenu(message(), { clientX: 10, clientY: 10 })

  expect(items()).toEqual(['Quote in reply', 'Copy', 'Copy message'])
  expect(screen.getByText('Shift + right-click for the browser’s menu')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('menuitem', { name: 'Quote in reply' }))
  await waitFor(() => expect(onQuote).toHaveBeenCalledWith('Total CHF 1,200.'))
  expect(document.getSelection()?.isCollapsed ?? true).toBe(true)
})

test('without a selection it copies the whole message', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  fireEvent.contextMenu(message(), { clientX: 10, clientY: 10 })

  expect(items()).toEqual(['Copy message'])
  await user.click(screen.getByRole('menuitem', { name: 'Copy message' }))
  await expect(navigator.clipboard.readText()).resolves.toBe('Two invoices are overdue.')
})

test('a selection reaching outside the message is clipped to it', async () => {
  const onQuote = vi.fn<(quote: string) => void>()
  render(<Harness onQuote={onQuote} />)
  const range = document.createRange()
  range.setStartBefore(screen.getByText('Outside the message'))
  range.setEnd(screen.getByText('Two invoices are overdue.').firstChild!, 3)
  document.getSelection()?.addRange(range)
  fireEvent.contextMenu(message(), { clientX: 10, clientY: 10 })
  await userEvent.click(screen.getByRole('menuitem', { name: 'Quote in reply' }))
  await waitFor(() => expect(onQuote).toHaveBeenCalledWith('Two'))
})

test('a selection elsewhere is not offered for quoting', () => {
  render(<Harness />)
  select(screen.getByText('Outside the message'))
  fireEvent.contextMenu(message(), { clientX: 10, clientY: 10 })
  expect(items()).toEqual(['Copy message'])
})

test('Copy as Markdown appears only when the source differs from the text', async () => {
  const user = userEvent.setup()
  const { unmount } = render(<Harness markdown="Two invoices are overdue." />)
  fireEvent.contextMenu(message(), { clientX: 10, clientY: 10 })
  expect(items()).toEqual(['Copy message'])
  unmount()

  render(<Harness markdown="Two invoices are **overdue**." />)
  fireEvent.contextMenu(message(), { clientX: 10, clientY: 10 })
  expect(items()).toEqual(['Copy message', 'Copy as Markdown'])
  await user.click(screen.getByRole('menuitem', { name: 'Copy as Markdown' }))
  await expect(navigator.clipboard.readText()).resolves.toBe('Two invoices are **overdue**.')
})

test.each([['shiftKey'], ['altKey']])('%s keeps the browser’s own menu', (key) => {
  render(<Harness />)
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, [key]: true })
  act(() => void message().dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

test('touch never opens it, so long-press selection stays the system’s', () => {
  render(<Harness />)
  fireEvent.pointerDown(message(), { pointerType: 'touch' })
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  act(() => void message().dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()

  fireEvent.pointerDown(message(), { pointerType: 'mouse', button: 2 })
  fireEvent.contextMenu(message(), { clientX: 10, clientY: 10 })
  expect(screen.getByRole('menu')).toBeInTheDocument()
})

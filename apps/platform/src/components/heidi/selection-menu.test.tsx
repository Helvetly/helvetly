import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'

import { SelectionMenu } from './selection-menu'

function Harness({ onQuote }: { onQuote: (quote: string) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  return (
    <div ref={root}>
      <div ref={scroller} data-testid="scroller">
        <p>Which invoices are overdue?</p>
        <div data-answer="">
          <p>Two invoices are overdue.</p>
          <p>Total CHF 1,200.</p>
        </div>
      </div>
      <SelectionMenu root={root} scroller={scroller} onQuote={onQuote} />
    </div>
  )
}

function select(from: Node, to: Node = from) {
  const range = document.createRange()
  range.setStartBefore(from)
  range.setEndAfter(to)
  act(() => {
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

// jsdom has no layout, so a range has no box of its own.
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  })
})
afterEach(() => document.getSelection()?.removeAllRanges())

test('a selection in an answer is quoted and the menu closes', async () => {
  const onQuote = vi.fn<(quote: string) => void>()
  render(<Harness onQuote={onQuote} />)
  select(screen.getByText('Two invoices are overdue.'))

  await userEvent.click(screen.getByRole('button', { name: 'Quote' }))
  expect(onQuote).toHaveBeenCalledWith('Two invoices are overdue.')
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
})

test('text outside an answer gets no menu', () => {
  render(<Harness onQuote={vi.fn<(quote: string) => void>()} />)
  select(screen.getByText('Which invoices are overdue?'))
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
})

test('Shift+F10 moves focus into the menu, arrows move along it and Escape closes it', async () => {
  render(<Harness onQuote={vi.fn<(quote: string) => void>()} />)
  select(screen.getByText('Two invoices are overdue.'))

  await userEvent.keyboard('{Shift>}{F10}{/Shift}')
  expect(screen.getByRole('button', { name: 'Quote' })).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('button', { name: 'Copy' })).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('button', { name: 'Quote' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
})

test('scrolling or a click elsewhere closes the menu', () => {
  render(<Harness onQuote={vi.fn<(quote: string) => void>()} />)
  select(screen.getByText('Two invoices are overdue.'))
  fireEvent.scroll(screen.getByTestId('scroller'))
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()

  select(screen.getByText('Total CHF 1,200.'))
  expect(screen.getByRole('toolbar', { name: 'Selected text' })).toBeInTheDocument()
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
})

test('Copy puts the selected text on the clipboard', async () => {
  const user = userEvent.setup()
  render(<Harness onQuote={vi.fn<(quote: string) => void>()} />)
  select(screen.getByText('Two invoices are overdue.'))

  await user.click(screen.getByRole('button', { name: 'Copy' }))
  expect(await navigator.clipboard.readText()).toContain('Two invoices are overdue.')
  expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
})

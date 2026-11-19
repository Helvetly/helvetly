import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle, useSheetEscape } from './sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

function Drawer({ onClose, children }: { onClose: () => void; children?: React.ReactNode }) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent showCloseButton={false}>
        <SheetTitle>Drawer</SheetTitle>
        <SheetDescription>Body</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  )
}

test('Esc closes a drawer even when its first control has a tooltip', async () => {
  const onClose = vi.fn<() => void>()
  render(
    <TooltipProvider delayDuration={0}>
      <Drawer onClose={onClose}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">More</button>
          </TooltipTrigger>
          <TooltipContent>More actions</TooltipContent>
        </Tooltip>
      </Drawer>
    </TooltipProvider>,
  )
  // Focus starts on the drawer, so no tooltip is open to take the Esc.
  expect(screen.getByRole('dialog')).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('a popover open inside the drawer takes Esc first', async () => {
  const onClose = vi.fn<() => void>()
  render(
    <Drawer onClose={onClose}>
      <Popover>
        <PopoverTrigger>Pick</PopoverTrigger>
        <PopoverContent>Options</PopoverContent>
      </Popover>
    </Drawer>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Pick' }))
  expect(screen.getByText('Options')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByText('Options')).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})

function Editor({ onCancel }: { onCancel: () => void }) {
  useSheetEscape(onCancel)
  return <p>Editor</p>
}

test('an editor that registers useSheetEscape gets Esc instead of the drawer closing', async () => {
  const onClose = vi.fn<() => void>()
  const onCancel = vi.fn<() => void>()
  render(
    <Drawer onClose={onClose}>
      <Editor onCancel={onCancel} />
    </Drawer>,
  )
  await userEvent.keyboard('{Escape}')
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onClose).not.toHaveBeenCalled()
})

function Toggle() {
  const [open, setOpen] = useState(true)
  return open ? <Drawer onClose={() => setOpen(false)} /> : <p>Closed</p>
}

test('a drawer unmounted while open leaves nothing behind without animations', async () => {
  render(<Toggle />)
  await userEvent.keyboard('{Escape}')
  expect(await screen.findByText('Closed')).toBeVisible()
  expect(document.querySelector('[data-slot=exit-ghost]')).toBeNull()
})

/** A browser's Web Animations API, which jsdom lacks: every element runs one animation until `end`. */
function animateElements() {
  const { promise: finished, resolve: end } = Promise.withResolvers<void>()
  const finish = vi.fn<() => void>()
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [{ finished, finish }],
  })
  onTestFinished(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  })
  return { end, finish }
}

const ghost = () => document.querySelector('[data-slot=exit-ghost]')

test('a drawer unmounted while open stays on screen, closing, until its exit animation ends', async () => {
  const { end } = animateElements()
  render(<Toggle />)
  await userEvent.keyboard('{Escape}')
  expect(await screen.findByText('Closed')).toBeVisible()
  // Both the backdrop and the drawer play their closed-state animation from an inert copy.
  await vi.waitFor(() => expect(ghost()).not.toBeNull())
  expect(ghost()?.querySelector('[data-slot=sheet-content][data-closed]')).not.toBeNull()
  expect(ghost()?.querySelector('[data-slot=sheet-overlay][data-closed]')).not.toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  end()
  await vi.waitFor(() => expect(ghost()).toBeNull())
})

test('a drawer replaced by another neither slides out nor lets the new one slide in', async () => {
  const { finish } = animateElements()
  render(<Swap />)
  await userEvent.click(screen.getByRole('button', { name: 'Open row' }))
  expect(finish).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  await vi.waitFor(() => expect(finish).toHaveBeenCalled())
  expect(ghost()).toBeNull()
})

// A drawer opened from state (a row, a URL), not a SheetTrigger: Radix has no trigger to refocus.
function StateDrawer({ unmountOnClose = false }: { unmountOnClose?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open row
      </button>
      {(open || !unmountOnClose) && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent showCloseButton={false}>
            <SheetTitle>Drawer</SheetTitle>
            <SheetDescription>Body</SheetDescription>
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}

test.each([
  ['closed', false],
  ['unmounted', true],
])(
  'focus returns to what opened a drawer from state when it is %s with Esc',
  async (_, unmount) => {
    render(<StateDrawer unmountOnClose={unmount} />)
    const opener = screen.getByRole('button', { name: 'Open row' })
    opener.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await vi.waitFor(() => expect(opener).toHaveFocus())
  },
)

function Swap() {
  const [which, setWhich] = useState<'none' | 'detail' | 'editor'>('none')
  return (
    <>
      <button type="button" onClick={() => setWhich('detail')}>
        Open row
      </button>
      {which !== 'none' && (
        <Sheet open onOpenChange={() => setWhich('none')}>
          <SheetContent key={which} showCloseButton={false}>
            <SheetTitle>{which}</SheetTitle>
            <SheetDescription>Body</SheetDescription>
            <button type="button" onClick={() => setWhich('editor')}>
              Edit
            </button>
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}

test('a drawer replaced by another keeps the focus in the new one', async () => {
  render(<Swap />)
  await userEvent.click(screen.getByRole('button', { name: 'Open row' }))
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  await vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'editor' })).toHaveFocus())
  // Radix restores focus on unmount in a later task; let it run, then focus must still be in the editor.
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.getByRole('dialog', { name: 'editor' })).toHaveFocus()
})

function RowCard() {
  const [card, setCard] = useState(false)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Popover open={card} onOpenChange={setCard}>
        <PopoverTrigger>Row</PopoverTrigger>
        <PopoverContent>
          <button
            type="button"
            onClick={() => {
              setCard(false)
              setOpen(true)
            }}
          >
            Open
          </button>
        </PopoverContent>
      </Popover>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent showCloseButton={false}>
          <SheetTitle>Drawer</SheetTitle>
          <SheetDescription>Body</SheetDescription>
        </SheetContent>
      </Sheet>
    </>
  )
}

test('a drawer opened from a popover gives focus back to the popover’s trigger', async () => {
  render(<RowCard />)
  await userEvent.click(screen.getByRole('button', { name: 'Row' }))
  screen.getByRole('button', { name: 'Open' }).focus()
  await userEvent.keyboard('{Enter}')
  await vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'Drawer' })).toHaveFocus())
  await userEvent.keyboard('{Escape}')
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Row' })).toHaveFocus())
})

function OpenDrawer() {
  const [open, setOpen] = useState(true)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent showCloseButton={false}>
        <SheetTitle>Drawer</SheetTitle>
        <SheetDescription>Body</SheetDescription>
      </SheetContent>
    </Sheet>
  )
}

test('focus skips a control whose popover is still fading out', async () => {
  // A row and its card as Radix draws them: the card is a role=dialog the row's aria-controls names.
  const row = document.body.appendChild(document.createElement('button'))
  row.textContent = 'Row'
  row.setAttribute('aria-controls', 'card')
  const card = document.body.appendChild(document.createElement('div'))
  card.id = 'card'
  card.setAttribute('role', 'dialog')
  card.setAttribute('data-state', 'open')
  const inCard = card.appendChild(document.createElement('button'))
  inCard.textContent = 'Open'
  inCard.focus()
  // The card starts fading out as the drawer opens: its button is still in the page, but leaving.
  card.setAttribute('data-state', 'closed')
  render(<OpenDrawer />)
  await vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'Drawer' })).toHaveFocus())
  await userEvent.keyboard('{Escape}')
  await vi.waitFor(() => expect(row).toHaveFocus())
  row.remove()
  card.remove()
})

test('a drawer is marked scrolled only while its content is scrolled away from the top', () => {
  render(<Drawer onClose={() => {}} />)
  const drawer = screen.getByRole('dialog')
  expect(drawer).not.toHaveAttribute('data-scrolled')
  drawer.scrollTop = 40
  fireEvent.scroll(drawer)
  expect(drawer).toHaveAttribute('data-scrolled')
  drawer.scrollTop = 0
  fireEvent.scroll(drawer)
  expect(drawer).not.toHaveAttribute('data-scrolled')
})

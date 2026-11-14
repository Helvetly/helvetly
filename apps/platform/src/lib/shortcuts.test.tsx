import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { nextTheme } from '@/components/shortcuts/theme-shortcut'

import { SHORTCUTS, useShortcut, type ShortcutId } from './shortcuts'

function Listener({ id, handler }: { id: ShortcutId; handler: () => void }) {
  useShortcut(id, handler)
  return (
    <>
      <input aria-label="Name" />
      <button type="button">Plain</button>
    </>
  )
}

const setup = (id: ShortcutId) => {
  const handler = vi.fn<() => void>()
  render(<Listener id={id} handler={handler} />)
  return handler
}

test('a ⌘/Ctrl shortcut works even while typing', () => {
  const handler = setup('heidi')
  fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'j', ctrlKey: true })
  fireEvent.keyDown(window, { key: 'j', metaKey: true })
  expect(handler).toHaveBeenCalledTimes(2)
})

test('a single key acts outside text fields only', () => {
  const handler = setup('help')
  fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'h' })
  expect(handler).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Plain' }), { key: 'h' })
  expect(handler).toHaveBeenCalledTimes(1)
})

test('a single key waits while a dialog or menu is open', () => {
  const handler = setup('shortcuts')
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  document.body.append(dialog)
  fireEvent.keyDown(window, { key: '?', shiftKey: true })
  expect(handler).not.toHaveBeenCalled()
  dialog.remove()
  fireEvent.keyDown(window, { key: '?', shiftKey: true })
  expect(handler).toHaveBeenCalledTimes(1)
})

test('handled, repeated and modified presses are ignored', () => {
  const handler = setup('theme')
  const handled = new KeyboardEvent('keydown', { key: 'd', cancelable: true })
  handled.preventDefault()
  window.dispatchEvent(handled)
  fireEvent.keyDown(window, { key: 'd', repeat: true })
  fireEvent.keyDown(window, { key: 'd', metaKey: true })
  expect(handler).not.toHaveBeenCalled()
})

test('a sequence: G then N', () => {
  const handler = setup('notifications')
  fireEvent.keyDown(window, { key: 'n' })
  expect(handler).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'g' })
  fireEvent.keyDown(window, { key: 'n' })
  expect(handler).toHaveBeenCalledTimes(1)
})

test('a matched shortcut takes the key from the browser', () => {
  setup('quickActions')
  const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})

test('no two shortcuts share keys', () => {
  const all = Object.values(SHORTCUTS).flatMap(({ keys }) => keys)
  expect(new Set(all).size).toBe(all.length)
})

test.each([
  ['light', 'dark'],
  ['dark', 'system'],
  ['system', 'light'],
  [undefined, 'light'],
])('the theme after %s is %s', (theme, next) => {
  expect(nextTheme(theme)).toBe(next)
})

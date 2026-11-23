import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

import { clippedRings } from '../focus-ring'

/** The header, the items and the separators of an open menu, in the order shown. */
export const menuOrder = (menu: HTMLElement) =>
  [...menu.querySelectorAll('[role=menuitem], [role=separator], [data-slot$=-label]')].map((node) =>
    node.getAttribute('role') === 'separator' ? '|' : (node.textContent ?? '').trim(),
  )

/**
 * Opens an item's "…" button, then right-clicks its row: both menus must be the same, in the same
 * order. Returns that order.
 */
export async function sameRowMenus(button: HTMLElement) {
  const body = within(button.ownerDocument.body)
  await userEvent.click(button)
  const fromButton = menuOrder(await body.findByRole('menu'))
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
  const row = button.closest('tr, li, [data-slot=context-menu-trigger]') ?? button
  fireEvent.contextMenu(row)
  const fromRow = menuOrder(await body.findByRole('menu'))
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
  // Clicking "…" in a narrow test frame scrolls its list sideways to reach it: scroll back, as the page started.
  for (let node = button.parentElement; node; node = node.parentElement) node.scrollLeft = 0
  await waitFor(() => expect(clippedRings(button.ownerDocument)).toEqual([]))
  await expect(fromRow).toEqual(fromButton)
  return fromButton
}

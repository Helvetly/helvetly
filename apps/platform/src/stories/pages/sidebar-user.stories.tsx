import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { sessionHandler, storySession } from '../screen-fixtures'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone } from './frame'

const longName = {
  ...storySession.user,
  name: 'Peteeeeeeeeer Kraaaaaaaaaaaajewski-Gomez',
  email: 'peteeeeeeeeer.kraaaaaaaaaaaajewski@example.com',
}

const meta = {
  title: 'Pages/Sidebar user',
  beforeEach: () => {
    closeHeidi()
    localStorage.removeItem('helvetly:sidebar')
  },
  parameters: pageParameters('/notifications'),
  render: () => (
    <Frame>
      <p className="p-6 text-muted-foreground">Page</p>
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)
/** The person's button at the bottom of the sidebar; on a phone the sidebar is a sheet behind Menu. */
async function userButton(canvasElement: HTMLElement, name: RegExp) {
  const screen = body(canvasElement)
  await screen.findByRole('main', { hidden: true }, { timeout: 8000 })
  const menu = screen.queryByRole('button', { name: 'Menu' })
  if (menu?.checkVisibility()) await userEvent.click(menu)
  return screen.findByRole('button', { name }, { timeout: 8000 })
}
/** Opens the account menu, checks its actions, and closes it again for the accessibility check. */
async function opensMenu(canvasElement: HTMLElement, button: HTMLElement) {
  const screen = body(canvasElement)
  await userEvent.click(button)
  const menu = await screen.findByRole('menu')
  await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Log out' })).toBeVisible())
  await expect(within(menu).getByRole('menuitem', { name: /Settings/ })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}

// A soft two-tone square, standing in for a profile photo.
const photo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#c9d8f5"/><circle cx="32" cy="26" r="12" fill="#7d93c4"/><rect x="12" y="42" width="40" height="30" rx="15" fill="#7d93c4"/></svg>',
)}`

/** With a photo: the picture in the rounded square, no initials. */
export const WithPhoto: Story = {
  parameters: pageParameters('/notifications', {}, [
    sessionHandler({ user: { ...storySession.user, avatar_url: photo } }),
  ]),
  play: async ({ canvasElement }) => {
    const button = await userButton(canvasElement, /Anna Muster/)
    await waitFor(() => expect(button.querySelector('img')).toBeVisible())
    await opensMenu(canvasElement, button)
  },
}
export const WithPhotoDark = dark(WithPhoto)

/** Without a photo: the initials on a soft tint, name and email, and the chevrons that say it opens a menu. */
export const NoPhoto: Story = {
  play: async ({ canvasElement }) => {
    const button = await userButton(canvasElement, /Anna Muster/)
    await expect(button).toHaveTextContent('AM')
    await expect(button).toHaveTextContent('anna@example.com')
    await expect(button.querySelector('.lucide-chevrons-up-down')).toBeVisible()
    await opensMenu(canvasElement, button)
  },
}
export const NoPhotoDark = dark(NoPhoto)
export const NoPhotoPhone = phone(NoPhoto)

/** A long name and email stay on one line each, cut with an ellipsis; the full text is in their title. */
export const LongName: Story = {
  parameters: pageParameters('/notifications', {}, [sessionHandler({ user: longName })]),
  play: async ({ canvasElement }) => {
    const button = await userButton(canvasElement, /Peteeeeeeeeer/)
    const name = within(button).getByTitle(longName.name)
    await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    await expect(within(button).getByTitle(longName.email)).toBeVisible()
    // The chevrons keep their place at the right edge, inside the button.
    const chevrons = button.querySelector('.lucide-chevrons-up-down')
    await expect(chevrons?.getBoundingClientRect().right).toBeLessThanOrEqual(
      button.getBoundingClientRect().right,
    )
    await opensMenu(canvasElement, button)
  },
}
export const LongNameDark = dark(LongName)
export const LongNamePhone = phone(LongName)

/** On the icon rail only the avatar shows; its tooltip names the person and it still opens the menu. */
export const Collapsed: Story = {
  beforeEach: () => {
    localStorage.setItem('helvetly:sidebar', 'collapsed')
    return () => localStorage.removeItem('helvetly:sidebar')
  },
  play: async ({ canvasElement }) => {
    const button = await userButton(canvasElement, /Anna Muster/)
    await expect(button.getBoundingClientRect().width).toBeLessThanOrEqual(32)
    await userEvent.hover(button)
    await expect(await body(canvasElement).findByRole('tooltip')).toHaveTextContent('Anna Muster')
    await userEvent.unhover(button)
    await opensMenu(canvasElement, button)
  },
}
export const CollapsedDark = dark(Collapsed)
export const LongNamePhoneDark = dark(phone(LongName))

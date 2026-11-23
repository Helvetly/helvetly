import { ActionMenuContent, type ActionMenuSpec } from '@helvetly/ui/components/action-menu'
import { Button } from '@helvetly/ui/components/button'
import { ContextMenu, ContextMenuTrigger } from '@helvetly/ui/components/context-menu'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Check, Copy, Download, PanelRightOpen, Pencil, Send, Trash2, X } from 'lucide-react'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { menuOrder } from './pages/menus'

const onSelect = fn()

/** Given out of order on purpose: the menu sorts them into its fixed groups. */
const spec: ActionMenuSpec = {
  header: 'Q-2026-004 · Keller Holzbau AG',
  actions: [
    { id: 'delete', group: 'danger', icon: <Trash2 />, label: 'Delete draft', onSelect },
    {
      id: 'contract',
      group: 'create',
      tone: 'ai',
      icon: <HeidiSparkle />,
      label: 'Create contract with AI',
      onSelect,
    },
    { id: 'edit', group: 'edit', icon: <Pencil />, label: 'Edit', onSelect },
    { id: 'accept', group: 'status', tone: 'success', icon: <Check />, label: 'Accept', onSelect },
    {
      id: 'decline',
      group: 'status',
      tone: 'destructive',
      icon: <X />,
      label: 'Decline',
      onSelect,
    },
    { id: 'open', group: 'view', icon: <PanelRightOpen />, label: 'Open details', onSelect },
    {
      id: 'send',
      group: 'send',
      icon: <Send />,
      label: 'Send',
      disabledReason: 'Add the client’s email first.',
      onSelect,
    },
    { id: 'duplicate', group: 'edit', icon: <Copy />, label: 'Duplicate', onSelect },
    false,
    { id: 'pdf', group: 'view', icon: <Download />, label: 'Download PDF', onSelect },
  ],
}

const ORDER =
  'Q-2026-004 · Keller Holzbau AG, Open details, Download PDF, |, Send, |, Accept, Decline, |, Edit, Duplicate, |, Create contract with AI, |, Delete draft'

const order = (menu: HTMLElement) => menuOrder(menu).join(', ')

/** Elements painted with each tone's token, to compare menu items against. */
function Tokens() {
  return (
    <span aria-hidden className="flex gap-2">
      <span data-testid="token-success" className="text-success">
        success
      </span>
      <span data-testid="token-ai" className="text-brand">
        ai
      </span>
      <span data-testid="token-destructive" className="text-destructive">
        destructive
      </span>
    </span>
  )
}

function Menus() {
  return (
    <div className="grid justify-items-start gap-4 p-8">
      <Tokens />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">More actions</Button>
        </DropdownMenuTrigger>
        <ActionMenuContent kind="dropdown" align="start" menu={spec} />
      </DropdownMenu>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-testid="row"
            className="rounded-lg border border-dashed px-6 py-4 text-sm text-muted-foreground"
          >
            Right-click this row
          </div>
        </ContextMenuTrigger>
        <ActionMenuContent kind="context" menu={spec} />
      </ContextMenu>
    </div>
  )
}

const meta = {
  title: 'Design system/Action menu',
  render: () => <Menus />,
  beforeEach: () => onSelect.mockClear(),
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

async function openDropdown(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'More actions' }))
  return body(canvasElement).findByRole('menu')
}

/** Header, fixed groups, separators only between non-empty groups, icons on every item. */
export const AllTones: Story = {
  play: async ({ canvasElement }) => {
    const menu = await openDropdown(canvasElement)
    await expect(order(menu)).toBe(ORDER)
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .filter((entry) => !entry.querySelector('svg')),
    ).toEqual([])
    const item = (name: string) => within(menu).getByRole('menuitem', { name })
    await expect(item('Accept')).toHaveAttribute('data-tone', 'success')
    await expect(item('Decline')).toHaveAttribute('data-tone', 'destructive')
    await expect(item('Delete draft')).toHaveAttribute('data-tone', 'destructive')
    await expect(item('Create contract with AI')).toHaveAttribute('data-tone', 'ai')
    await expect(item('Edit')).not.toHaveAttribute('data-tone')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body(canvasElement).queryByRole('menu')).toBeNull())
  },
}
export const AllTonesDark: Story = { ...AllTones, parameters: { dark: true } }

/** The "…" menu and the right-click menu of the same item are one definition: identical. */
export const DropdownMatchesContextMenu: Story = {
  play: async ({ canvasElement }) => {
    const fromButton = order(await openDropdown(canvasElement))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body(canvasElement).queryByRole('menu')).toBeNull())
    fireEvent.contextMenu(within(canvasElement).getByTestId('row'))
    const context = await body(canvasElement).findByRole('menu')
    await expect(order(context)).toBe(fromButton)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body(canvasElement).queryByRole('menu')).toBeNull())
  },
}

/** A disabled item keeps its reason: a tooltip on hover, and choosing it does nothing. */
export const DisabledWithReason: Story = {
  play: async ({ canvasElement }) => {
    const menu = await openDropdown(canvasElement)
    const send = within(menu).getByRole('menuitem', { name: 'Send' })
    await expect(send).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(send)
    await expect(await body(canvasElement).findByRole('tooltip')).toHaveTextContent(
      'Add the client’s email first.',
    )
    await userEvent.click(send)
    await expect(onSelect).not.toHaveBeenCalled()
    await expect(body(canvasElement).getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body(canvasElement).queryByRole('menu')).toBeNull())
  },
}

const color = (element: Element) => getComputedStyle(element).color
const background = (element: Element) => getComputedStyle(element).backgroundColor

/**
 * Hovered or focused, a toned item keeps its tone: text and icon stay in the token's colour and the
 * row takes a tint of it, never the neutral grey of a plain item. Its box does not move.
 */
export const ToneOnFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const menu = await openDropdown(canvasElement)
    const item = (name: string) => within(menu).getByRole('menuitem', { name })
    const plain = item('Edit')
    plain.focus()
    await waitFor(() => expect(plain).toHaveAttribute('data-highlighted'))
    const neutral = background(plain)
    const keepsTone = async (
      name: string,
      tone: 'success' | 'destructive' | 'ai',
      via: 'hover' | 'focus',
    ) => {
      const toned = item(name)
      const token = color(canvas.getByTestId(`token-${tone}`))
      const before = toned.getBoundingClientRect()
      await expect(color(toned)).toBe(token)
      if (via === 'hover') await userEvent.hover(toned)
      else toned.focus()
      await waitFor(() => expect(toned).toHaveAttribute('data-highlighted'))
      await expect(color(toned)).toBe(token)
      await expect(background(toned)).not.toBe(neutral)
      await expect(background(toned)).not.toBe('rgba(0, 0, 0, 0)')
      // Heidi's sparkle keeps its own gradient; every other icon takes the tone.
      const icon = toned.querySelector('svg')
      if (tone !== 'ai' && icon) await expect(color(icon)).toBe(token)
      const after = toned.getBoundingClientRect()
      await expect([after.height, after.width]).toEqual([before.height, before.width])
    }
    await keepsTone('Accept', 'success', 'hover')
    await keepsTone('Decline', 'destructive', 'focus')
    await keepsTone('Create contract with AI', 'ai', 'hover')
    await keepsTone('Delete draft', 'destructive', 'focus')
    await keepsTone('Accept', 'success', 'focus')
    await keepsTone('Create contract with AI', 'ai', 'focus')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body(canvasElement).queryByRole('menu')).toBeNull())
  },
}
export const ToneOnFocusDark: Story = { ...ToneOnFocus, parameters: { dark: true } }

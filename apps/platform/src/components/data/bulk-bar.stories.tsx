import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Archive,
  ArchiveRestore,
  CircleCheck,
  Download,
  KeyRound,
  LockKeyhole,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react'
import { expect, fn, screen, userEvent, within } from 'storybook/test'

import { BulkBar, type BulkAction } from './table-page'

const status = { label: 'Status', icon: <CircleCheck /> }
const portal = { label: 'Portal', icon: <KeyRound /> }
const run = fn()

const clientActions = (only?: string[]): BulkAction[] =>
  [
    { label: 'Activate', icon: <Power />, group: status },
    { label: 'Deactivate', icon: <PowerOff />, group: status },
    { label: 'Archive', icon: <Archive />, group: status },
    { label: 'Unarchive', icon: <ArchiveRestore />, group: status },
    { label: 'Enable portal', icon: <KeyRound />, group: portal },
    { label: 'Disable portal', icon: <LockKeyhole />, group: portal },
    { label: 'Export CSV', icon: <Download /> },
    { label: 'Delete', icon: <Trash2 />, destructive: true },
  ]
    .filter((action) => !only || only.includes(action.label))
    .map((action) => ({ ...action, onClick: () => run(action.label), write: true }))

const meta = {
  title: 'Data/Bulk bar',
  component: BulkBar,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex min-h-96 flex-col">
        <Story />
      </div>
    ),
  ],
  args: { count: 6, actions: clientActions(), onClear: fn() },
} satisfies Meta<typeof BulkBar>

export default meta
type Story = StoryObj<typeof meta>

/** Paired actions share one named menu; Delete comes last, apart. */
export const Grouped: Story = {
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('toolbar')
    const buttons = within(bar).getAllByRole('button')
    await expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Status',
      'Portal',
      'Export CSV',
      'Delete',
    ])
    await userEvent.click(within(bar).getByRole('button', { name: 'Status' }))
    const menu = await screen.findByRole('menu')
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Activate', 'Deactivate', 'Archive', 'Unarchive'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }))
    await expect(run).toHaveBeenCalledWith('Archive')
  },
}

/** A group left with one sensible action shows it as a plain button, no menu. */
export const SingleActionsUngrouped: Story = {
  args: {
    count: 2,
    actions: clientActions(['Deactivate', 'Enable portal', 'Export CSV', 'Delete']),
  },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('toolbar')
    await expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Deactivate', 'Enable portal', 'Export CSV', 'Delete'])
    await userEvent.click(within(bar).getByRole('button', { name: 'Deactivate' }))
    await expect(run).toHaveBeenCalledWith('Deactivate')
  },
}

/** Delete is passed first here and still ends the bar. */
export const DestructiveLast: Story = {
  args: { count: 3, actions: [...clientActions(['Delete']), ...clientActions(['Export CSV'])] },
  play: async ({ canvasElement }) => {
    const buttons = within(within(canvasElement).getByRole('toolbar')).getAllByRole('button')
    await expect(buttons.at(-1)).toHaveAccessibleName('Delete')
  },
}

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
}

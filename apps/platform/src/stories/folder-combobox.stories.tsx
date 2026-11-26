import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import {
  FolderPathInput,
  folderEntries,
  folderProblem,
} from '@/components/documents/folder-combobox'
import type { Folder } from '@/lib/documents'

const folder = (id: string, name: string, parent: string | null, system_kind?: string) =>
  ({ id, name, parent_id: parent, system_kind: system_kind ?? null }) as Folder
const entries = folderEntries([
  folder('a', 'Clients', null, 'clients'),
  folder('b', 'Acme', 'a', 'client'),
  folder('c', 'Documents', 'b', 'documents'),
  folder('d', '2026', 'c', 'year'),
  folder('e', 'Contracts', 'd', 'contracts'),
  folder('f', 'Projects', 'd'),
  folder('g', '2027', 'c', 'year'),
  folder('h', 'Contracts', null),
])
const existing = new Set(entries.map(({ path }) => path.toLowerCase()))

function Harness({ start }: { start: string }) {
  const [value, setValue] = useState(start)
  const problem = folderProblem(value, existing)
  return (
    <div className="grid max-w-lg gap-2 bg-card p-5">
      <FolderPathInput
        entries={entries}
        value={value}
        label="Folder for scan.pdf"
        invalid={problem !== null}
        onChange={setValue}
      />
      {problem && <p role="alert">{problem}</p>}
      <output>{value || 'Top level'}</output>
    </div>
  )
}

const meta = { title: 'Documents/Folder path', component: Harness } satisfies Meta<typeof Harness>
export default meta
type Story = StoryObj<typeof meta>

export const EditPath: Story = {
  args: { start: 'Clients/Acme/Documents/2026/Contracts' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: /^Change folder Contracts/ }))
    const current = await body.findByRole('option', { name: /Contracts/ })
    await expect(within(current).getByLabelText(/managed by Helvetly/i)).toBeInTheDocument()
    await expect(body.getAllByRole('option')).toHaveLength(2)
    await userEvent.click(body.getByRole('option', { name: 'Projects' }))
    await expect(canvas.getByText('Clients/Acme/Documents/2026/Projects')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: /^Change folder 2026/ }))
    await userEvent.click(await body.findByRole('option', { name: /2027/ }))
    await expect(canvas.getByText('Clients/Acme/Documents/2027')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove folder Documents from path' }))
    await expect(canvas.getByText('Clients/Acme')).toBeVisible()
  },
}

export const AddFolder: Story = {
  args: { start: 'Clients/Acme/Documents/2026' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: /^Add folder/ }))
    await userEvent.click(await body.findByRole('option', { name: /Contracts/ }))
    await expect(canvas.getByText('Clients/Acme/Documents/2026/Contracts')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove folder Clients from path' }))
    await userEvent.click(canvas.getByRole('button', { name: /^Add folder/ }))
    await userEvent.click(await body.findByRole('option', { name: 'Contracts' }))
    await userEvent.click(canvas.getByRole('button', { name: /^Add folder/ }))
    await userEvent.type(await body.findByPlaceholderText(/search/i), 'Renewals')
    await userEvent.click(await body.findByText(/Add “Renewals”/))
    await expect(canvas.getByText('Contracts/Renewals')).toBeVisible()
  },
}

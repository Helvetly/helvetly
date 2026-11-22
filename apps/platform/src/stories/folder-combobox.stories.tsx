import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { FolderCombobox, folderProblem } from '@/components/documents/folder-combobox'
import type { Folder } from '@/lib/documents'

const folder = (id: string, name: string, parent: string | null, system_kind?: string) =>
  ({ id, name, parent_id: parent, system_kind: system_kind ?? null }) as Folder

const folders = [
  folder('a', 'Clients', null, 'clients'),
  folder('b', 'Acme', 'a', 'client'),
  folder('c', 'Invoices', 'b', 'invoices'),
  folder('d', '2026', 'c', 'year'),
  folder('e', 'Contracts', null),
]
const existing = new Set(
  [
    'Clients',
    'Clients/Acme',
    'Clients/Acme/Invoices',
    'Clients/Acme/Invoices/2026',
    'Contracts',
  ].map((path) => path.toLowerCase()),
)

function Harness({ start }: { start: string }) {
  const [value, setValue] = useState(start)
  const problem = folderProblem(value, existing)
  return (
    <div className="grid max-w-md gap-1.5 bg-card p-5">
      <FolderCombobox
        folders={folders}
        value={value}
        label="Folder for scan.pdf"
        invalid={problem !== null}
        onChange={setValue}
      />
      {problem && <p role="alert">{problem}</p>}
    </div>
  )
}

const meta = { title: 'Documents/Folder picker', component: Harness } satisfies Meta<typeof Harness>
export default meta
type Story = StoryObj<typeof meta>

const field = (canvas: ReturnType<typeof within>) =>
  canvas.getByRole('button', { name: /Folder for scan.pdf/ })

export const PickExisting: Story = {
  args: { start: 'Clients/Acme/Invoices/2026' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(field(canvas)).toHaveTextContent('Clients › Acme › Invoices › 2026')
    await userEvent.click(field(canvas))
    await userEvent.click(await within(document.body).findByRole('option', { name: /Contracts/ }))
    await waitFor(() => expect(field(canvas)).toHaveTextContent('Contracts'))
  },
}

export const Search: Story = {
  args: { start: '' },
  play: async ({ canvasElement }) => {
    await userEvent.click(field(within(canvasElement)))
    const body = within(document.body)
    await userEvent.type(await body.findByPlaceholderText(/search/i), 'contr')
    await waitFor(() => expect(body.getAllByRole('option')).toHaveLength(2))
    await expect(body.getByRole('option', { name: /Contracts/ })).toBeVisible()
  },
}

export const CreateNew: Story = {
  args: { start: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(field(canvas))
    const body = within(document.body)
    await userEvent.type(await body.findByPlaceholderText(/search/i), 'Contracts/2027')
    await userEvent.click(await body.findByText(/Add “Contracts\/2027”/))
    await waitFor(() => expect(field(canvas)).toHaveTextContent('Contracts › 2027'))
    await expect(canvas.queryByRole('alert')).toBeNull()
  },
}

export const SystemFolderLock: Story = {
  args: { start: '' },
  play: async ({ canvasElement }) => {
    await userEvent.click(field(within(canvasElement)))
    const option = await within(document.body).findByRole('option', {
      name: /^Clients › Acme(?! ›)/,
    })
    await expect(within(option).getByLabelText(/managed by Helvetly/i)).toBeInTheDocument()
    const plain = within(document.body).getByRole('option', { name: /Contracts/ })
    await expect(within(plain).queryByLabelText(/managed by Helvetly/i)).toBeNull()
  },
}

export const ValidationError: Story = {
  args: { start: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(field(canvas))
    const body = within(document.body)
    await userEvent.type(await body.findByPlaceholderText(/search/i), 'Clients/Newco')
    await userEvent.click(await body.findByText(/Add “Clients\/Newco”/))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(/Helvetly manages/)
    await expect(field(canvas)).toHaveAttribute('aria-invalid', 'true')
  },
}

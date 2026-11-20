import { Badge, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useQuery } from '@tanstack/react-query'
import { FileText, Mail } from 'lucide-react'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Composer, DetailsPopover, type RowDetails } from '@/components/data/row-details'
import { TablePage } from '@/components/data/table-page'
import { NewFolderDialog } from '@/components/documents/dialogs'
import { KIND_STYLE } from '@/components/documents/kind'
import { Kpi, KpiBand, Sparkline } from '@/components/kpi-band'

import { screenHandlers } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Secondary',
  parameters: { msw: { handlers: screenHandlers } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const SemanticColors: Story = {
  render: () => (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {(['green', 'blue', 'amber', 'red', 'neutral'] satisfies Tone[]).map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(KIND_STYLE).map(([kind, style]) => (
          <span className={`rounded px-2 text-xs ${style.tint}`} key={kind}>
            {style.ext}
          </span>
        ))}
      </div>
      <Button variant="destructive">Delete draft</Button>
      <Button variant="outline">Cancel</Button>
    </div>
  ),
}
export const SemanticColorsDark: Story = { ...SemanticColors, parameters: { dark: true } }
export const PersistentDestructiveConfirmation: Story = {
  render: () => (
    <ConfirmDialog
      title="Delete draft?"
      body="Issued financial records are kept."
      confirmLabel="Delete draft"
      tone="destructive"
      onDecide={fn()}
    />
  ),
  play: async () => {
    await waitFor(() =>
      expect(within(document.body).getByRole('dialog', { name: 'Delete draft?' })).toBeVisible(),
    )
  },
}

const details: RowDetails = {
  name: 'Alpenglow Studio GmbH',
  fields: [{ icon: Mail, label: 'Email', value: 'office@alpenglow.ch' }],
  action: 'Contact',
  drafts: [{ label: 'Payment reminder', text: 'Please review the invoice due on 30 November.' }],
}
export const DetailsAndDraft: Story = {
  render: () => <DetailsPopover details={details}>Alpenglow Studio GmbH</DetailsPopover>,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Alpenglow Studio GmbH' }),
    )
    const body = within(document.body)
    await waitFor(() => expect(body.getByText('office@alpenglow.ch')).toBeVisible())
    await userEvent.click(body.getByRole('button', { name: 'Contact' }))
    await userEvent.click(await body.findByRole('button', { name: /Payment reminder/ }))
    await expect(
      body.getByRole('textbox', { name: 'Message to Alpenglow Studio GmbH' }),
    ).toHaveValue('Please review the invoice due on 30 November.')
    await expect(body.getByRole('button', { name: 'Send' })).toBeEnabled()
  },
}
export const ComposerKeyboard: Story = {
  render: () => <Composer to="Alpenglow" drafts={details.drafts} onClose={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: 'Message to Alpenglow' })).toHaveFocus()
    await userEvent.type(canvas.getByRole('textbox'), '   ')
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Let Heidi write it' }))
    await expect(canvas.getByRole('textbox')).toHaveValue(details.drafts[0]?.text ?? '')
  },
}

const folderName = fn()
function FolderDialog() {
  const [closed, setClosed] = useState(false)
  return closed ? (
    <output>Folder created</output>
  ) : (
    <NewFolderDialog
      parentName="All documents"
      onCreate={async (name) => {
        folderName(name)
        return name === 'Contracts' ? 'A folder with this name already exists here.' : null
      }}
      onClose={() => setClosed(true)}
    />
  )
}
export const FolderClashAndRetry: Story = {
  render: () => <FolderDialog />,
  play: async () => {
    const body = within(document.body)
    const input = await body.findByRole('textbox', { name: 'Folder name' })
    await expect(body.getByRole('button', { name: 'Create' })).toBeDisabled()
    await userEvent.type(input, 'Contracts')
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(body.getByText('A folder with this name already exists here.')).toBeVisible(),
    )
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await userEvent.clear(input)
    await userEvent.type(input, ' Contracts 2027 ')
    await userEvent.keyboard('{Enter}')
    await expect(await body.findByText('Folder created')).toBeVisible()
    await expect(folderName).toHaveBeenLastCalledWith('Contracts 2027')
  },
}
type Row = { id: string; name: string; status: string }
function GenericTable() {
  const query = useQuery({
    queryKey: ['storybook-table'],
    queryFn: async (): Promise<Row[]> => [
      { id: 'a', name: 'Alpenglow Studio GmbH', status: 'Active' },
      { id: 'b', name: 'Muster AG', status: 'Inactive' },
    ],
  })
  return (
    <SidebarProvider>
      <div className="flex min-w-0 flex-1 flex-col">
        <TablePage
          views={[{ label: 'All' }, { label: 'Active', filter: (row) => row.status === 'Active' }]}
          primary="New contact"
          noun="contacts"
          query={query}
          columns={[
            { header: 'Name', width: 'w-2/3', cell: (row) => row.name },
            { header: 'Status', width: 'w-1/3', cell: (row) => row.status },
          ]}
          line={(row) => ({ title: row.name, subtitle: row.status })}
          details={(row) => ({ ...details, name: row.name })}
        />
      </div>
    </SidebarProvider>
  )
}
export const TableSearchAndSelection: Story = {
  render: () => <GenericTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('checkbox', { name: 'Select Muster AG' }))
    await expect(canvas.getByRole('toolbar', { name: 'Selected rows' })).toHaveTextContent(
      'Selected: 1',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Clear selection' }))
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search contacts' }), 'missing')
    await waitFor(() => expect(canvas.getByText('Nothing matches “missing”')).toBeVisible())
    await userEvent.click(canvas.getByRole('button', { name: 'Show all contacts' }))
    await expect(canvas.getByRole('searchbox')).toHaveValue('')
  },
}
export const EmptyKpiHistory: Story = {
  render: () => (
    <div className="@container">
      <KpiBand loading={false}>
        <Kpi label="Outstanding" value="0" chart={<Sparkline values={[]} />} />
      </KpiBand>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('circle')).not.toBeInTheDocument()
  },
}
export const NarrowKpiKeyboard: Story = {
  render: () => (
    <div className="@container w-[272px]">
      <KpiBand loading={false}>
        {['Outstanding', 'Paid', 'Spent'].map((label) => (
          <Kpi key={label} label={label} value="0" chart={<FileText />} />
        ))}
      </KpiBand>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: 'Key figures' })
    await userEvent.tab()
    await expect(within(band).getByRole('button', { name: 'Scroll key figures' })).toHaveFocus()
    await expect(band.scrollWidth).toBeGreaterThan(band.clientWidth)
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(band.scrollLeft).toBeGreaterThan(0))
  },
}

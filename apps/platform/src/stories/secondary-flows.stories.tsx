import { Badge, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

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

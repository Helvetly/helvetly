import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { Meter } from '@helvetly/ui/components/meter'
import { Panel } from '@helvetly/ui/components/panel'
import { Segmented } from '@helvetly/ui/components/segmented'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Bell,
  CircleAlert,
  CircleCheck,
  FileText,
  Info,
  Inbox,
  Settings,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

const meta = {
  title: 'Design system/Components',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Callouts: Story = {
  render: () => (
    <div className="grid max-w-xl gap-3">
      <Callout tone="info" icon={Info} title="Sent to the client">
        They get an email with the PDF and a link to pay.
      </Callout>
      <Callout
        tone="warning"
        icon={TriangleAlert}
        title="Finish the address to start invoicing"
        actions={<Button>Complete</Button>}
      >
        Missing: postcode, city
      </Callout>
      <Callout tone="danger" icon={CircleAlert} title="Overdue by 12 days" />
      <Callout tone="success" icon={CircleCheck}>
        All invoices of March are paid.
      </Callout>
      <Callout tone="neutral">A plain note without an icon.</Callout>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const callouts = canvasElement.querySelectorAll('[data-slot=callout]')
    await expect([...callouts].map((callout) => callout.getAttribute('data-tone'))).toEqual([
      'info',
      'warning',
      'danger',
      'success',
      'neutral',
    ])
    await expect(within(canvasElement).getByRole('button', { name: 'Complete' })).toBeVisible()
  },
}

export const IconTiles: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconTile icon={Settings} variant="section" />
      <IconTile icon={FileText} variant="row" />
      <IconTile icon={Bell} variant="neutral" />
      <IconTile icon={Sparkles} variant="heidi" />
      <IconTile icon={Bell} size="sm" />
      <IconTile icon={Bell} size="lg" />
    </div>
  ),
}

export const Meters: Story = {
  render: () => (
    <div className="grid max-w-sm gap-4">
      <Meter label="Clients: 3 of 10" value={3} max={10} />
      <Meter label="Clients: 8 of 10" value={8} max={10} />
      <Meter label="Clients: 9 of 10" value={9} max={10} />
      <Meter label="Clients: 10 of 10" value={10} max={10} />
      <Meter label="Hours: 12 of 10" value={12} max={10} marker={5} size="lg" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const tones = [...canvasElement.querySelectorAll('[data-slot=meter]')].map((meter) =>
      meter.getAttribute('data-tone'),
    )
    await expect(tones).toEqual(['brand', 'warning', 'danger', 'danger', 'danger'])
    await expect(canvasElement.querySelector('[data-part=overage]')).not.toBeNull()
    await expect(within(canvasElement).getByLabelText('Clients: 8 of 10')).toHaveValue(8)
  },
}

export const PanelAndEmptyState: Story = {
  render: () => (
    <div className="grid max-w-xl gap-3">
      <Panel title="Contact" action={<Button variant="link">Edit</Button>}>
        <p className="text-body">Anna Muster · anna@example.ch</p>
      </Panel>
      <Panel>
        <EmptyState
          icon={Inbox}
          title="No invoices yet"
          description="Create your first invoice and it shows up here."
          action={<Button>New invoice</Button>}
        />
      </Panel>
    </div>
  ),
}

function SegmentedDemo() {
  const [value, setValue] = useState('month')
  return (
    <Segmented
      label="Period"
      value={value}
      onChange={setValue}
      options={[
        { value: 'month', label: 'This month' },
        { value: 'quarter', label: 'This quarter' },
        { value: 'year', label: 'This year' },
      ]}
    />
  )
}

export const SegmentedControl: Story = {
  render: () => (
    <div className="grid gap-3">
      <SegmentedDemo />
      <SegmentedDemo />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const [first, second] = within(canvasElement).getAllByRole('group', { name: 'Period' })
    if (!first || !second) throw new Error('Expected two segmented controls')
    await userEvent.click(within(first).getByRole('radio', { name: 'This quarter' }))
    await expect(within(first).getByRole('radio', { name: 'This quarter' })).toBeChecked()
    // Same label, separate groups: the second control keeps its own choice.
    await expect(within(second).getByRole('radio', { name: 'This month' })).toBeChecked()
  },
}

import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import {
  Command,
  CommandCreateItem,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@helvetly/ui/components/command'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
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
  Plus,
  Inbox,
  Settings,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { DropOverlay } from '@/components/import/page-drop'

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
      <Callout tone="neutral">A plain note gets its tone's icon too.</Callout>
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
    // Every tone has an icon, given or its own.
    await expect([...callouts].filter((callout) => !callout.querySelector('svg'))).toEqual([])
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

/** Every drop zone: a thin dashed brand edge on a light brand tint, the label in plain text. */
export const DropZone: Story = {
  render: () => (
    // A transform makes the overlay's fixed position relative to this frame instead of the page.
    <div className="relative h-72 max-w-xl transform-gpu overflow-hidden rounded-xl bg-muted">
      <DropOverlay title="Drop to import these invoices" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const overlay = canvasElement.querySelector('[data-slot="drop-overlay"] > div')
    if (!(overlay instanceof HTMLElement)) throw new Error('Expected the drop overlay')
    await expect(within(overlay).getByText('Drop to import these invoices')).toBeVisible()
    const style = getComputedStyle(overlay)
    await expect(style.borderTopWidth).toBe('1px')
    await expect(style.borderTopStyle).toBe('dashed')
  },
}

const CATEGORIES = [
  ['Travel', '6640'],
  ['Software', '6570'],
  ['Office supplies', '6500'],
  ['Telephone', '6510'],
  ['Advertising', '6600'],
  ['Training', '5810'],
  ['Insurance', '6300'],
  ['Rent', '6000'],
  ['Repairs', '6100'],
  ['Vehicles', '6200'],
]

/** A picker's list as it opens: the add row stays at the end, in view, while the options scroll above it. */
export const PickerWithAddRow: Story = {
  render: () => (
    <div className="w-72 rounded-lg border bg-popover shadow-md">
      <Command>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandGroup>
            {CATEGORIES.map(([name, account]) => (
              <CommandItem key={name} value={name}>
                <span className="flex-1">{name}</span>
                <CommandShortcut className="tracking-normal tabular-nums">
                  {account}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandCreateItem className="justify-start">
            <Plus />
            Add category
          </CommandCreateItem>
        </CommandList>
      </Command>
    </div>
  ),
}

/** The AI action button: an outline button's box with a violet, blue and pink edge; still with reduced motion (CSS). */
export const AiActionButton: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button variant="outline">Upload</Button>
      <Button variant="ai">
        <HeidiSparkle />
        Organize with AI
      </Button>
      <Button variant="ai" size="sm">
        <HeidiSparkle />
        Small
      </Button>
      <Button variant="ai" disabled>
        <HeidiSparkle />
        Disabled
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Organize with AI' })
    await expect(button).toHaveAttribute('data-variant', 'ai')
    await expect(button.querySelector('svg')).not.toBeNull()
    // the gradient edge is painted behind the border, and the box matches the outline button's
    await expect(getComputedStyle(button).backgroundClip).toBe('padding-box, border-box')
    await expect(button.getBoundingClientRect().height).toBe(
      canvas.getByRole('button', { name: 'Upload' }).getBoundingClientRect().height,
    )
    await expect(getComputedStyle(button).borderRadius).toBe(
      getComputedStyle(canvas.getByRole('button', { name: 'Upload' })).borderRadius,
    )
  },
}

export const AiActionButtonDark: Story = { ...AiActionButton, parameters: { dark: true } }

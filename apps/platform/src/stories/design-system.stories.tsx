import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { FormField, describedBy } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Label } from '@helvetly/ui/components/label'
import { Switch } from '@helvetly/ui/components/switch'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { Textarea } from '@helvetly/ui/components/textarea'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { BellRing, DoorOpen, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

const meta = {
  title: 'Design system/Controls',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const ButtonVariants: Story = {
  // The baseline shows the keyboard focus ring on Cancel.
  parameters: { visual: { keepFocus: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Save</Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">More</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="link">Read details</Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const primary = canvas.getByRole('button', { name: 'Save' })
    await Promise.all(
      canvas
        .getAllByRole('button')
        .flatMap((button) => [
          expect(button.getBoundingClientRect().height).toBe(
            primary.getBoundingClientRect().height,
          ),
          expect(getComputedStyle(button).borderRadius).toBe(
            getComputedStyle(primary).borderRadius,
          ),
        ]),
    )
    await userEvent.click(primary)
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  },
}

export const ButtonSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
      <Button size="xl">Extra large</Button>
      <Button size="icon-xs" aria-label="Add small">
        <Plus />
      </Button>
      <Button size="icon-sm" aria-label="Add medium">
        <Plus />
      </Button>
      <Button size="icon" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon-lg" aria-label="Add large">
        <Plus />
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heights = ['Extra small', 'Small', 'Default', 'Large', 'Extra large'].map(
      (name) => canvas.getByRole('button', { name }).getBoundingClientRect().height,
    )
    await expect(heights).toEqual([24, 28, 32, 36, 40])
    await Promise.all(
      ['Add small', 'Add medium', 'Add', 'Add large'].map((name) => {
        const box = canvas.getByRole('button', { name }).getBoundingClientRect()
        return expect(box.width).toBe(box.height)
      }),
    )
  },
}

const onDisabledClick = fn()
export const DisabledAndLoading: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button disabled onClick={onDisabledClick}>
        Unavailable
      </Button>
      <Button disabled aria-busy="true">
        Saving…
      </Button>
      <Button variant="outline" disabled>
        Cancel unavailable
      </Button>
      <Button variant="ghost" size="icon" disabled aria-label="Cannot close">
        <X />
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await Promise.all(
      within(canvasElement)
        .getAllByRole('button')
        .map((button) => expect(button).toBeDisabled()),
    )
    await expect(onDisabledClick).not.toHaveBeenCalled()
  },
}

export const ButtonAsLink: Story = {
  render: () => (
    <Button asChild variant="outline">
      <a href="#details">View document</a>
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'View document' })
    await expect(link).toHaveAttribute('data-variant', 'outline')
    await expect(link).toHaveAttribute('href', '#details')
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  },
}

function Fields() {
  const [checked, setChecked] = useState(false)
  const [enabled, setEnabled] = useState(false)
  return (
    <div className="grid max-w-md gap-4">
      <FormField id="story-name" label="Name" required>
        <Input id="story-name" required />
      </FormField>
      <FormField id="story-note" label="Note">
        <Textarea id="story-note" />
      </FormField>
      <div className="flex items-center gap-2">
        <Checkbox
          id="story-agree"
          checked={checked}
          onCheckedChange={(value) => setChecked(value === true)}
        />
        <Label htmlFor="story-agree">Accept terms</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="story-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="story-enabled">Enable reminders</Label>
      </div>
      <output aria-label="Selection">{checked && enabled ? 'Ready' : 'Incomplete'}</output>
    </div>
  )
}

export const KeyboardFields: Story = {
  render: () => <Fields />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('textbox', { name: 'Name' }))
    await userEvent.type(canvas.getByRole('textbox', { name: 'Name' }), 'Sprüngli AG')
    await userEvent.tab()
    await expect(canvas.getByRole('textbox', { name: 'Note' })).toHaveFocus()
    await userEvent.tab()
    await userEvent.keyboard(' ')
    await expect(canvas.getByRole('checkbox', { name: 'Accept terms' })).toBeChecked()
    await userEvent.tab()
    await userEvent.keyboard(' ')
    await expect(canvas.getByRole('switch', { name: 'Enable reminders' })).toBeChecked()
    await expect(canvas.getByRole('status', { name: 'Selection' })).toHaveTextContent('Ready')
  },
}

function SwitchRows() {
  const [reminders, setReminders] = useState(false)
  const [portal, setPortal] = useState(true)
  const [vat, setVat] = useState(false)
  return (
    <div className="grid max-w-xl gap-2">
      <SwitchRow
        label="Registered for VAT"
        description="Off: invoices carry no VAT and say so."
        checked={vat}
        onCheckedChange={setVat}
      />
      <SwitchRow
        icon={DoorOpen}
        label="Let the client sign in"
        description="With its email, or the billing email when there is no email."
        checked={portal}
        onCheckedChange={setPortal}
      />
      <SwitchRow
        icon={BellRing}
        label="Payment reminders"
        description="Overdue invoices get dunning reminders, when dunning is on. Each level goes out once, to the client’s billing email, with a QR bill for the total; sending one by hand works either way."
        checked={reminders}
        onCheckedChange={setReminders}
      />
      <SwitchRow
        label="Default interest"
        description="Simple interest on the open amount (OR 104)."
        checked
        disabled
        onCheckedChange={() => {}}
      />
      <SwitchRow
        label="Allow Heidi to use OpenAI"
        description="AI answers for the whole workspace."
        checked={false}
        disabledReason="Only an owner or admin can change this."
        onCheckedChange={() => {}}
      />
    </div>
  )
}

export const SwitchRowStates: Story = {
  render: () => <SwitchRows />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const vat = canvas.getByRole('switch', { name: 'Registered for VAT' })
    await userEvent.tab()
    await expect(vat).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect(vat).toBeChecked()
    await expect(vat.closest('[data-slot=switch-row]')).toHaveAttribute('data-checked')
    const portal = canvas.getByRole('switch', { name: 'Let the client sign in' })
    await userEvent.click(canvas.getByText(/billing email when there is no email/))
    await expect(portal).not.toBeChecked()
    await expect(canvas.getByRole('switch', { name: 'Default interest' })).toBeDisabled()
    const locked = canvas.getByRole('switch', { name: 'Allow Heidi to use OpenAI' })
    await expect(locked).toBeDisabled()
    await expect(locked).toHaveAccessibleDescription(
      'AI answers for the whole workspace. Only an owner or admin can change this.',
    )
  },
}

export const SwitchRowStatesDark: Story = {
  ...SwitchRowStates,
  parameters: { dark: true },
}

export const ValidationError: Story = {
  render: () => (
    <FormField id="story-vat" label="VAT number" error="Check the VAT number.">
      <Input {...describedBy('story-vat', 'Check the VAT number.')} defaultValue="INVALID" />
    </FormField>
  ),
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'VAT number' })
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(input).toHaveAccessibleDescription('Check the VAT number.')
  },
}

export const HelpByKeyboard: Story = {
  render: () => (
    <div className="grid max-w-sm gap-4">
      <Button>Start here</Button>
      <FormField
        id="story-help"
        label="Tax category"
        tip="Choose the category for this transaction, not just the customer country."
      >
        <Input id="story-help" />
      </FormField>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Start here' }))
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'About Tax category' })).toHaveFocus()
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(
      'Choose the category for this transaction',
    )
  },
}

export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Active</Badge>
      <Badge variant="secondary">Draft</Badge>
      <Badge variant="outline">Archived</Badge>
      <Badge variant="destructive">Failed</Badge>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await Promise.all(
      ['Active', 'Draft', 'Archived', 'Failed'].map((text) =>
        expect(within(canvasElement).getByText(text)).toBeVisible(),
      ),
    )
  },
}

export const KeyboardTabs: Story = {
  render: () => (
    <Tabs defaultValue="invoices">
      <TabsList aria-label="Financial records">
        <TabsTrigger value="invoices">Invoices</TabsTrigger>
        <TabsTrigger value="expenses">Expenses</TabsTrigger>
        <TabsTrigger value="archived" disabled>
          Archived
        </TabsTrigger>
      </TabsList>
      <TabsContent value="invoices">Your invoices</TabsContent>
      <TabsContent value="expenses">Your expenses</TabsContent>
    </Tabs>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Invoices' }))
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Expenses' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Your expenses')
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Invoices' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

/** A password manager adds a zero-size relative box after an input; focusing it must move nothing. */
const frame = () => new Promise((done) => requestAnimationFrame(done))

const injectedHost = (input: HTMLElement) => {
  const host = document.createElement('div')
  for (const [name, value] of Object.entries({
    position: 'relative',
    height: '0',
    width: '0',
    display: 'initial',
    float: 'left',
  }))
    host.style.setProperty(name, value, 'important')
  input.after(host)
  return host
}

export const ExtensionBoxBesideInput: Story = {
  render: () => (
    <div data-testid="rows" className="grid max-w-md gap-4">
      <FormField id="story-email" label="Email">
        <Input id="story-email" type="email" />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField id="story-phone" label="Phone">
          <Input id="story-phone" />
        </FormField>
        <FormField id="story-web" label="Website">
          <Input id="story-web" />
        </FormField>
      </div>
      <FormField id="story-street" label="Street">
        <Input id="story-street" />
      </FormField>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const email = canvas.getByRole('textbox', { name: 'Email' })
    let host: HTMLElement | undefined
    const boxes = () =>
      [...canvasElement.querySelectorAll('[data-testid=rows] *')]
        .filter((element) => element !== host)
        .map((element) => {
          const { left, top, width, height } = element.getBoundingClientRect()
          return [left, top, width, height]
        })
    const before = boxes()
    host = injectedHost(email)
    try {
      await userEvent.click(email)
      await frame()
      await frame()
      const after = boxes()
      const moved = after.flatMap((box, index) =>
        box.some((value, i) => Math.abs(value - (before[index]?.[i] ?? 0)) >= 0.5) ? [index] : [],
      )
      await expect(email).toHaveFocus()
      await expect(moved).toEqual([])
    } finally {
      host.remove()
    }
  },
}

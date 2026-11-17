import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  ArrowDownUp,
  ArrowLeftRight,
  ArrowRight,
  ChartPie,
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FileText,
  FileUp,
  Funnel,
  ListFilter,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { expect, waitFor, within } from 'storybook/test'

const meta = {
  title: 'Design system/Icon motion',
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const labelled = [
  { label: 'Name', icon: ArrowDownUp, variant: 'outline' },
  { label: 'Upload', icon: Plus, variant: 'default' },
  { label: 'Filter', icon: ListFilter, variant: 'outline' },
  { label: 'Filters', icon: Funnel, variant: 'outline' },
  { label: 'View', icon: SlidersHorizontal, variant: 'outline' },
  { label: 'Import', icon: Upload, variant: 'outline' },
  { label: 'Export', icon: Download, variant: 'outline' },
  { label: 'Continue', icon: ArrowRight, variant: 'default', end: true },
  { label: 'Open', icon: ExternalLink, variant: 'ghost', end: true },
  { label: 'Send', icon: Send, variant: 'default' },
  { label: 'Edit', icon: Pencil, variant: 'outline' },
  { label: 'Reset', icon: RotateCcw, variant: 'ghost' },
  { label: 'More', icon: ChevronDown, variant: 'outline', end: true },
  { label: 'Delete', icon: Trash2, variant: 'destructive-ghost' },
] as const

const iconOnly = [
  { label: 'Search', icon: Search },
  { label: 'Settings', icon: Settings },
  { label: 'Copy', icon: Copy },
  { label: 'Refresh', icon: RefreshCw },
  { label: 'Close', icon: X },
] as const

function Gallery() {
  return (
    <div className="grid max-w-2xl gap-4 p-4">
      <p className="text-sm text-muted-foreground">
        Hover, focus or press a button: its icon moves by its meaning. Reduced motion keeps every
        icon still.
      </p>
      <div className="flex flex-wrap gap-2">
        {labelled.map(({ label, icon: Icon, variant, ...rest }) => (
          <Button key={label} variant={variant}>
            {'end' in rest ? null : <Icon data-icon="inline-start" />}
            {label}
            {'end' in rest ? <Icon data-icon="inline-end" /> : null}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {iconOnly.map(({ label, icon: Icon }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <Button aria-label={label} size="icon" variant="outline">
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Button disabled variant="outline">
        <Plus data-icon="inline-start" />
        Disabled stays still
      </Button>
    </div>
  )
}

function icon(button: HTMLElement) {
  const svg = button.querySelector('svg')
  if (!svg) throw new Error(`No icon in ${button.textContent}`)
  return svg
}

/** Focus by keyboard: the motions share one trigger (hover, focus-visible, press), and only focus can be
 * driven for real from a play function (a synthetic pointer does not set CSS `:hover`). */
async function keyboardFocus(element: HTMLElement) {
  element.focus()
  await waitFor(() => expect(element.matches(':focus-visible')).toBe(true))
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

/** The element's box once fonts are in and two frames in a row agree: the baseline a focus must not move. */
async function settledBox(element: HTMLElement) {
  await document.fonts.ready
  let box = element.getBoundingClientRect()
  await waitFor(async () => {
    await frame()
    const next = element.getBoundingClientRect()
    const same = JSON.stringify(next.toJSON()) === JSON.stringify(box.toJSON())
    box = next
    expect(same).toBe(true)
  })
  return box
}

export const Motions: Story = {
  render: () => <Gallery />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const upload = canvas.getByRole('button', { name: 'Upload' })
    const before = await settledBox(upload)
    expect(getComputedStyle(icon(upload)).rotate).toBe('none')
    await keyboardFocus(upload)
    await waitFor(() => expect(getComputedStyle(icon(upload)).rotate).toBe('90deg'))
    // Transforms only: the button keeps its size and place.
    expect(upload.getBoundingClientRect().toJSON()).toEqual(before.toJSON())

    const search = canvas.getByRole('button', { name: 'Search' })
    await keyboardFocus(search)
    await waitFor(() => expect(getComputedStyle(icon(search)).scale).toBe('1.15'))

    const settings = canvas.getByRole('button', { name: 'Settings' })
    await keyboardFocus(settings)
    await waitFor(() => expect(getComputedStyle(icon(settings)).rotate).toBe('60deg'))

    const sort = canvas.getByRole('button', { name: 'Name' })
    await keyboardFocus(sort)
    expect(getComputedStyle(icon(sort)).animationName).toBe('nudge')

    const filter = canvas.getByRole('button', { name: 'Filter' })
    await keyboardFocus(filter)
    const lines = icon(filter).children
    expect(getComputedStyle(lines[1]!).animationName).toBe('nudge')
    expect(getComputedStyle(lines[2]!).animationName).toBe('nudge')

    const refresh = canvas.getByRole('button', { name: 'Refresh' })
    await keyboardFocus(refresh)
    expect(getComputedStyle(icon(refresh)).animationName).toBe('icon-spin')

    // Blurred, the icon turns back.
    await keyboardFocus(canvas.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(getComputedStyle(icon(upload)).rotate).toBe('none'))
  },
}

/** The vector a shape nudges by; empty for a shape that stays put. */
function nudge(shape: Element) {
  return getComputedStyle(shape).getPropertyValue('--nudge').trim()
}

/** Menus and tab bars: the same motions, triggered by a menu's highlight and a tab's selection. */
function MenuAndTabs() {
  return (
    <div className="grid max-w-2xl gap-6 p-4">
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">
            <FileText /> Invoices
          </TabsTrigger>
          <TabsTrigger value="partial">
            <ChartPie /> Partial invoices
          </TabsTrigger>
          <TabsTrigger value="credit">
            <Undo2 /> Credit notes
          </TabsTrigger>
          <TabsTrigger value="self">
            <ArrowLeftRight /> Self-billed
          </TabsTrigger>
        </TabsList>
        {['invoices', 'partial', 'credit', 'self'].map((value) => (
          <TabsContent key={value} value={value} className="sr-only">
            {value}
          </TabsContent>
        ))}
      </Tabs>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="More actions" size="icon" variant="ghost">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuItem>
            <FileUp /> Import
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Download /> Export CSV
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FileText /> Invoice settings
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Daily e-mail digest</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export const MenusAndTabs: Story = {
  render: () => <MenuAndTabs />,
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)

    // Selecting a tab pops its icon once; a hovered or focused tab's icon moves by its kind.
    const partial = canvas.getByRole('tab', { name: 'Partial invoices' })
    expect(getComputedStyle(icon(partial)).animationName).toBe('none')
    await userEvent.click(partial)
    await waitFor(() => expect(partial).toHaveAttribute('aria-selected', 'true'))
    expect(getComputedStyle(icon(partial)).animationName).toBe('icon-pop')
    const credit = canvas.getByRole('tab', { name: 'Credit notes' })
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(credit).toHaveFocus())
    await waitFor(() => expect(getComputedStyle(icon(credit)).animationName).toBe('nudge'))
    const self = canvas.getByRole('tab', { name: 'Self-billed' })
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(self).toHaveFocus())
    // Each arrow of the pair slides its own way.
    const arrows = icon(self).children
    await waitFor(() => expect(getComputedStyle(arrows[0]!).animationName).toBe('nudge'))
    expect(nudge(arrows[0]!)).toBe('-3px 0')
    expect(nudge(arrows[3]!)).toBe('3px 0')

    // A highlighted menu item moves its icon: Import's arrow rises, plain icons grow a touch.
    await userEvent.click(canvas.getByRole('button', { name: 'More actions' }))
    const importItem = await page.findByRole('menuitem', { name: 'Import' })
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(importItem).toHaveAttribute('data-highlighted'))
    const fileUp = icon(importItem).children
    // Only the arrow moves; the page stays where it is.
    expect(nudge(fileUp[0]!)).toBe('')
    for (const arrow of [fileUp[2]!, fileUp[3]!]) {
      expect(getComputedStyle(arrow).animationName).toBe('nudge')
      expect(nudge(arrow)).toBe('0 -3px')
    }

    const exportItem = page.getByRole('menuitem', { name: 'Export CSV' })
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(exportItem).toHaveAttribute('data-highlighted'))
    expect(getComputedStyle(icon(exportItem).children[2]!).animationName).toBe('nudge')
    // Highlight left Import: its arrow is still again.
    await waitFor(() => expect(getComputedStyle(fileUp[2]!).animationName).toBe('none'))

    const settings = page.getByRole('menuitem', { name: 'Invoice settings' })
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(getComputedStyle(icon(settings)).scale).toBe('1.12'))

    // A checkbox item's check is state, not an action: it stays still.
    const digest = page.getByRole('menuitemcheckbox', { name: 'Daily e-mail digest' })
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(digest).toHaveAttribute('data-highlighted'))
    expect(getComputedStyle(icon(digest)).scale).toBe('none')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('menu')).toBeNull())
  },
}

/** Every rule that moves an icon sits under `prefers-reduced-motion: no-preference`. */
function iconMotionRules(rules: CSSRuleList, allowed: boolean, out: { allowed: boolean }[]) {
  for (const rule of Array.from(rules)) {
    let inside = allowed
    if (rule instanceof CSSMediaRule)
      inside ||= rule.conditionText.includes('prefers-reduced-motion: no-preference')
    if (rule instanceof CSSStyleRule && rule.selectorText.includes('lucide')) {
      const style = rule.style
      if (
        ['animation', 'rotate', 'scale', 'translate', 'transition'].some((p) =>
          style.getPropertyValue(p),
        )
      )
        out.push({ allowed: inside })
    }
    if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList)
      iconMotionRules(rule.cssRules, inside, out)
  }
  return out
}

export const ReducedMotionKeepsIconsStill: Story = {
  render: () => <Gallery />,
  play: async () => {
    const found: { allowed: boolean }[] = []
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      iconMotionRules(rules, false, found)
    }
    expect(found.length).toBeGreaterThanOrEqual(8)
    expect(found.filter((rule) => !rule.allowed)).toEqual([])
  },
}

/** Adjacent buttons: one spacing everywhere, set once in globals.css (not per page). */
export const ButtonSpacing: Story = {
  render: () => (
    <div className="grid gap-4 p-4">
      <div data-testid="toolbar" className="flex items-center gap-1">
        <Button aria-label="More" size="icon" variant="ghost">
          <X />
        </Button>
        <Button variant="outline">Document</Button>
        <Button variant="outline">Edit</Button>
        <Button>New invoice</Button>
      </div>
      <div data-testid="footer" className="flex justify-end gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Save</Button>
      </div>
      <div data-testid="icons" className="flex gap-1">
        <Button aria-label="Copy" size="icon-sm" variant="ghost">
          <Copy />
        </Button>
        <Button aria-label="Delete" size="icon-sm" variant="ghost">
          <Trash2 />
        </Button>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const gap = (id: string) => getComputedStyle(canvas.getByTestId(id)).columnGap
    expect(gap('toolbar')).toBe('10px')
    expect(gap('footer')).toBe('10px')
    // Icon-only clusters stay as dense as they were written.
    expect(gap('icons')).toBe('4px')
    const [document, edit] = [
      canvas.getByRole('button', { name: 'Document' }),
      canvas.getByRole('button', { name: 'Edit' }),
    ]
    expect(edit.getBoundingClientRect().left - document.getBoundingClientRect().right).toBe(10)
  },
}
